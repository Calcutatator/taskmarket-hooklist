// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITokenUsdOracle, PriceData } from "../interfaces/ITokenUsdOracle.sol";
import { TickMath } from "../lib/TickMath.sol";
import { FullMath } from "../lib/FullMath.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface IAerodromeCLPool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            bool unlocked
        );
}

/// @title AerodromeOracle
/// @notice TWAP price oracle wrapping an Aerodrome CL (Uniswap V3-compatible) pool.
///         Returns TOKEN per 1 USDC, scaled to 1e18.
contract AerodromeOracle is ITokenUsdOracle, Ownable {
    IAerodromeCLPool public immutable pool;
    address public immutable token;
    address public immutable usdc;

    uint32 public twapWindow;
    uint256 public minLiquidity;
    uint256 public maxStaleness;

    // true when USDC is token0 in the pool (price = sqrtPrice^2 gives TOKEN/USDC directly)
    bool public immutable usdcIsToken0;

    // scaling factor: 10^(TOKEN_DECIMALS + 12) bridges 6-decimal USDC to 18-decimal price
    uint256 public immutable priceScaler;

    constructor(
        address _pool,
        address _token,
        address _usdc,
        uint8 _tokenDecimals,
        uint32 _twapWindow,
        uint256 _minLiquidity,
        uint256 _maxStaleness,
        address _owner
    ) Ownable(_owner) {
        pool = IAerodromeCLPool(_pool);
        token = _token;
        usdc = _usdc;
        twapWindow = _twapWindow;
        minLiquidity = _minLiquidity;
        maxStaleness = _maxStaleness;

        address token0 = IAerodromeCLPool(_pool).token0();
        usdcIsToken0 = (token0 == _usdc);

        // price = USDC per 1 whole TOKEN, scaled to 1e18.
        // USDC has 6 decimals, TOKEN has _tokenDecimals.
        // P_1e18 = (USDC_raw / TOKEN_raw) * 10^(tokenDec - usdcDec) * 1e18
        //        = (USDC_raw / TOKEN_raw) * 10^(tokenDec - 6 + 18)
        priceScaler = 10 ** (uint256(_tokenDecimals) + 12);
    }

    function getTwapWindow() external view returns (uint32) {
        return twapWindow;
    }

    /// @notice Returns TOKEN/USDC TWAP price scaled to 1e18.
    ///         Returns valid=false if the pool is illiquid, stale, or observe() reverts.
    function getPrice() external view returns (PriceData memory data) {
        data.twapWindow = twapWindow;
        data.updatedAt = block.timestamp;
        data.liquidity = pool.liquidity();

        if (data.liquidity < minLiquidity) {
            return data; // valid = false (default)
        }

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        // slither-disable-next-line uninitialized-local
        int56[] memory tickCumulatives;
        // slither-disable-next-line unused-return
        try pool.observe(secondsAgos) returns (int56[] memory tc, uint160[] memory) {
            tickCumulatives = tc;
        } catch {
            return data; // valid = false
        }

        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(tickDelta / int56(uint56(twapWindow)));
        // Round towards negative infinity
        if (tickDelta < 0 && tickDelta != int56(int24(avgTick)) * int56(uint56(twapWindow))) {
            avgTick--;
        }

        // sqrtPriceX96 = sqrt(token1_raw / token0_raw) * 2^96
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(avgTick);

        // priceRatioX192 = (token1_raw / token0_raw) * 2^192
        uint256 priceRatioX192 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1);

        // We want USDC per TOKEN (whole units), scaled 1e18.
        uint256 price;
        if (usdcIsToken0) {
            // token1 = TOKEN, token0 = USDC. rawPrice = TOKEN_raw/USDC_raw.
            // USDC_raw/TOKEN_raw = 1/rawPrice = 2^192 / priceRatioX192
            // P = (USDC_raw/TOKEN_raw) * scaler
            price = FullMath.mulDiv(priceScaler, 1 << 192, priceRatioX192);
        } else {
            // token1 = USDC, token0 = TOKEN. rawPrice = USDC_raw/TOKEN_raw.
            // P = rawPrice * scaler = priceRatioX192 * scaler / 2^192
            price = FullMath.mulDiv(priceRatioX192, priceScaler, 1 << 192);
        }

        if (price == 0) {
            return data; // valid = false
        }

        data.price = price;
        data.valid = true;
    }

    function setTwapWindow(uint32 _twapWindow) external onlyOwner {
        twapWindow = _twapWindow;
    }

    function setMinLiquidity(uint256 _minLiquidity) external onlyOwner {
        minLiquidity = _minLiquidity;
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        maxStaleness = _maxStaleness;
    }
}
