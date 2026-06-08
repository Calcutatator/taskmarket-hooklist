// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITokenUsdOracle, PriceData } from "../interfaces/ITokenUsdOracle.sol";
import { TickMath } from "../lib/TickMath.sol";
import { FullMath } from "../lib/FullMath.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface ICLPool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
}

/// @title CompositeTwapOracle
/// @notice Chains two Aerodrome CL (Uniswap V3-compatible) pool TWAPs to price a token in USD.
///         Intended for TOKEN/BRIDGE -> BRIDGE/USDC composition when no direct TOKEN/USDC pool exists.
///         Returns USDC per 1 whole TOKEN, scaled to 1e18 — same convention as AerodromeOracle.
///
/// Math:
///   priceA = BRIDGE per TOKEN, 1e18  (from poolA)
///   priceB = USDC per BRIDGE,  1e18  (from poolB)
///   result = mulDiv(priceA, priceB, 1e18) = USDC per TOKEN, 1e18
contract CompositeTwapOracle is ITokenUsdOracle, Ownable {
    ICLPool public immutable poolA; // TOKEN/BRIDGE (e.g. DREAMS/WETH)
    ICLPool public immutable poolB; // BRIDGE/USDC  (e.g. WETH/USDC)

    // true when TOKEN is token0 in poolA
    bool public immutable tokenIsToken0InA;
    // true when BRIDGE is token0 in poolB
    bool public immutable bridgeIsToken0InB;

    // 10^(tokenDecimals + 18 - bridgeDecimals): scales ratioX192 to BRIDGE_per_TOKEN_1e18
    // For 18-dec TOKEN / 18-dec BRIDGE: 10^18
    uint256 public immutable priceScalerA;

    // 10^(bridgeDecimals + 12): scales ratioX192 to USDC_per_BRIDGE_1e18 (assumes USDC = 6 dec)
    // For 18-dec BRIDGE: 10^30
    uint256 public immutable priceScalerB;

    uint32 public twapWindow;
    uint256 public minLiquidityA;
    uint256 public minLiquidityB;
    uint256 public maxStaleness;

    /// @param _poolA           TOKEN/BRIDGE Aerodrome CL pool
    /// @param _token           TOKEN address (e.g. DREAMS)
    /// @param _tokenDecimals   TOKEN decimals
    /// @param _poolB           BRIDGE/USDC Aerodrome CL pool
    /// @param _bridge          BRIDGE address (e.g. WETH)
    /// @param _bridgeDecimals  BRIDGE decimals (e.g. 18 for WETH)
    /// @param _twapWindow      Seconds for both TWAP windows
    /// @param _minLiquidityA   Minimum in-range liquidity for poolA validity
    /// @param _minLiquidityB   Minimum in-range liquidity for poolB validity
    /// @param _maxStaleness    Stored for reference; TWAP is inherently fresh
    /// @param _owner           Owner for admin setters
    constructor(
        address _poolA,
        address _token,
        uint8 _tokenDecimals,
        address _poolB,
        address _bridge,
        uint8 _bridgeDecimals,
        uint32 _twapWindow,
        uint256 _minLiquidityA,
        uint256 _minLiquidityB,
        uint256 _maxStaleness,
        address _owner
    ) Ownable(_owner) {
        require(uint256(_tokenDecimals) + 18 >= uint256(_bridgeDecimals), "CompositeTwapOracle: decimal underflow");

        poolA = ICLPool(_poolA);
        poolB = ICLPool(_poolB);

        tokenIsToken0InA = (ICLPool(_poolA).token0() == _token);
        bridgeIsToken0InB = (ICLPool(_poolB).token0() == _bridge);

        priceScalerA = 10 ** (uint256(_tokenDecimals) + 18 - uint256(_bridgeDecimals));
        priceScalerB = 10 ** (uint256(_bridgeDecimals) + 12);

        twapWindow = _twapWindow;
        minLiquidityA = _minLiquidityA;
        minLiquidityB = _minLiquidityB;
        maxStaleness = _maxStaleness;
    }

    function getTwapWindow() external view returns (uint32) {
        return twapWindow;
    }

    /// @notice Returns USDC per 1 whole TOKEN, scaled to 1e18.
    ///         Returns valid=false if either pool is illiquid, observe() reverts, or price is zero.
    function getPrice() external view returns (PriceData memory data) {
        data.twapWindow = twapWindow;
        data.updatedAt = block.timestamp;

        uint128 liqA = poolA.liquidity();
        uint128 liqB = poolB.liquidity();
        // Report the weaker leg so callers see the binding constraint
        data.liquidity = liqA < liqB ? uint256(liqA) : uint256(liqB);

        if (liqA < minLiquidityA || liqB < minLiquidityB) {
            return data; // valid = false
        }

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        // --- Pool A: BRIDGE per TOKEN ---
        // slither-disable-next-line uninitialized-local
        int56[] memory tcA;
        // slither-disable-next-line unused-return
        try poolA.observe(secondsAgos) returns (int56[] memory tc, uint160[] memory) {
            tcA = tc;
        } catch {
            return data;
        }

        uint256 priceA = _twapPrice(tcA, twapWindow, priceScalerA, tokenIsToken0InA);
        if (priceA == 0) return data;

        // --- Pool B: USDC per BRIDGE ---
        // slither-disable-next-line uninitialized-local
        int56[] memory tcB;
        // slither-disable-next-line unused-return
        try poolB.observe(secondsAgos) returns (int56[] memory tc, uint160[] memory) {
            tcB = tc;
        } catch {
            return data;
        }

        uint256 priceB = _twapPrice(tcB, twapWindow, priceScalerB, bridgeIsToken0InB);
        if (priceB == 0) return data;

        // Composite: USDC per TOKEN = (BRIDGE/TOKEN) * (USDC/BRIDGE)
        uint256 price = FullMath.mulDiv(priceA, priceB, 1e18);
        if (price == 0) return data;

        data.price = price;
        data.valid = true;
    }

    /// @dev Derives a scaled price from tick cumulatives.
    ///      baseIsToken0=true  → token1/token0 ratio is quote/base → direct
    ///      baseIsToken0=false → token1/token0 ratio is base/quote → invert
    function _twapPrice(int56[] memory tickCumulatives, uint32 window, uint256 scaler, bool baseIsToken0)
        private
        pure
        returns (uint256)
    {
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(delta / int56(uint56(window)));
        // Round towards negative infinity
        if (delta < 0 && delta != int56(int24(avgTick)) * int56(uint56(window))) {
            avgTick--;
        }

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(avgTick);
        // ratioX192 = token1_raw / token0_raw * 2^192
        uint256 ratioX192 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1);

        if (baseIsToken0) {
            // token0 = base, token1 = quote → ratioX192 = quote_raw/base_raw * 2^192 → direct
            return FullMath.mulDiv(ratioX192, scaler, 1 << 192);
        } else {
            // token0 = quote, token1 = base → ratioX192 = base_raw/quote_raw * 2^192 → invert
            return FullMath.mulDiv(scaler, 1 << 192, ratioX192);
        }
    }

    function setTwapWindow(uint32 _twapWindow) external onlyOwner {
        twapWindow = _twapWindow;
    }

    function setMinLiquidityA(uint256 _minLiquidity) external onlyOwner {
        minLiquidityA = _minLiquidity;
    }

    function setMinLiquidityB(uint256 _minLiquidity) external onlyOwner {
        minLiquidityB = _minLiquidity;
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        maxStaleness = _maxStaleness;
    }
}
