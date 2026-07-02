// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { CompositeTwapOracle } from "../src/oracle/CompositeTwapOracle.sol";
import { PriceData } from "../src/interfaces/ITokenUsdOracle.sol";
import { TickMath } from "../src/lib/TickMath.sol";
import { FullMath } from "../src/lib/FullMath.sol";

// Minimal mock of an Aerodrome CL pool
contract MockCLPool {
    address public token0;
    address public token1;
    uint128 public liquidityVal;
    int56[2] public tickCumulatives; // [old, new]
    bool public observeReverts;

    constructor(address _token0, address _token1, uint128 _liq) {
        token0 = _token0;
        token1 = _token1;
        liquidityVal = _liq;
    }

    function liquidity() external view returns (uint128) {
        return liquidityVal;
    }

    function setTickCumulatives(int56 older, int56 newer) external {
        tickCumulatives[0] = older;
        tickCumulatives[1] = newer;
    }

    function setLiquidity(uint128 _liq) external {
        liquidityVal = _liq;
    }

    function setObserveReverts(bool _reverts) external {
        observeReverts = _reverts;
    }

    function observe(uint32[] calldata) external view returns (int56[] memory tc, uint160[] memory slc) {
        require(!observeReverts, "MockCLPool: observe revert");
        tc = new int56[](2);
        tc[0] = tickCumulatives[0];
        tc[1] = tickCumulatives[1];
        slc = new uint160[](2);
    }
}

contract CompositeTwapOracleTest is Test {
    address constant DREAMS = address(0xD1);
    address constant WETH = address(0x1E);
    address constant USDC = address(0xC1);
    address constant OWNER = address(0x0A);

    uint8 constant DREAMS_DECIMALS = 18;
    uint8 constant WETH_DECIMALS = 18;
    uint32 constant TWAP_WINDOW = 3600;

    MockCLPool poolA; // DREAMS/WETH — DREAMS=token0
    MockCLPool poolB; // WETH/USDC — WETH=token0
    CompositeTwapOracle oracle;

    // Tick helpers
    // avgTick -> sqrtPriceX96^2 / 2^192 = token1_raw / token0_raw
    // We set tickCumulatives such that delta/window = targetTick
    function _setTick(MockCLPool pool, int24 tick) internal {
        int56 delta = int56(int24(tick)) * int56(uint56(TWAP_WINDOW));
        pool.setTickCumulatives(0, delta);
    }

    function setUp() public {
        // poolA: DREAMS=token0, WETH=token1
        poolA = new MockCLPool(DREAMS, WETH, 1e18);
        // poolB: WETH=token0, USDC=token1
        poolB = new MockCLPool(WETH, USDC, 1e18);

        oracle = new CompositeTwapOracle(
            address(poolA),
            DREAMS,
            DREAMS_DECIMALS,
            address(poolB),
            WETH,
            USDC,
            WETH_DECIMALS,
            TWAP_WINDOW,
            0, // minLiquidityA
            0, // minLiquidityB
            OWNER
        );
    }

    // -------------------------------------------------------------------------
    // Helpers to compute expected prices from ticks
    // -------------------------------------------------------------------------

    function _tickToRatioX192(int24 tick) internal pure returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        return FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1);
    }

    // priceScalerA = 10^18 (both 18-dec)
    // tokenIsToken0InA = true (DREAMS=token0) -> direct: ratioX192 * scaler / 2^192
    function _expectedPriceA(int24 tick) internal pure returns (uint256) {
        uint256 ratioX192 = _tickToRatioX192(tick);
        return FullMath.mulDiv(ratioX192, 1e18, 1 << 192);
    }

    // priceScalerB = 10^30 (18-dec WETH, 6-dec USDC)
    // bridgeIsToken0InB = true (WETH=token0) -> direct: ratioX192 * scaler / 2^192
    function _expectedPriceB(int24 tick) internal pure returns (uint256) {
        uint256 ratioX192 = _tickToRatioX192(tick);
        return FullMath.mulDiv(ratioX192, 1e30, 1 << 192);
    }

    // -------------------------------------------------------------------------
    // Tests
    // -------------------------------------------------------------------------

    function test_immutables() public view {
        assertEq(oracle.priceScalerA(), 1e18);
        assertEq(oracle.priceScalerB(), 1e30);
        assertTrue(oracle.tokenIsToken0InA());
        assertTrue(oracle.bridgeIsToken0InB());
        assertEq(oracle.twapWindow(), TWAP_WINDOW);
    }

    function test_happyPath_composesPrice() public {
        // DREAMS/WETH pool (DREAMS=token0, WETH=token1):
        //   ratio = WETH_raw/DREAMS_raw (both 18 dec) = WETH_whole/DREAMS_whole
        //   At DREAMS=$0.09, WETH=$3000: ratio = 0.09/3000 = 3e-5
        //   tick = log_1.0001(3e-5) ~= -104_140
        int24 tickA = -104_140;

        // WETH/USDC pool (WETH=token0 18dec, USDC=token1 6dec):
        //   ratio = USDC_raw/WETH_raw = (3000*1e6)/(1e18) = 3e-9
        //   tick = log_1.0001(3e-9) ~= -196_247
        int24 tickB = -196_247;

        _setTick(poolA, tickA);
        _setTick(poolB, tickB);

        PriceData memory data = oracle.getPrice();

        assertTrue(data.valid);
        assertGt(data.price, 0);

        // Verify math: price should equal mulDiv(priceA, priceB, 1e18)
        uint256 expectedA = _expectedPriceA(tickA);
        uint256 expectedB = _expectedPriceB(tickB);
        uint256 expected = FullMath.mulDiv(expectedA, expectedB, 1e18);
        assertEq(data.price, expected);

        // Rough sanity: DREAMS ~$0.09, price should be ~0.09e18
        assertGt(data.price, 0.05e18);
        assertLt(data.price, 0.2e18);
    }

    function test_invalidWhenPoolALow() public {
        _setTick(poolA, -104_140);
        _setTick(poolB, 80_068);
        poolA.setLiquidity(0);

        oracle = new CompositeTwapOracle(
            address(poolA),
            DREAMS,
            DREAMS_DECIMALS,
            address(poolB),
            WETH,
            USDC,
            WETH_DECIMALS,
            TWAP_WINDOW,
            1e10, // minLiquidityA = 1e10, pool has 0
            0,
            OWNER
        );

        PriceData memory data = oracle.getPrice();
        assertFalse(data.valid);
    }

    function test_invalidWhenPoolBLow() public {
        _setTick(poolA, -104_140);
        _setTick(poolB, -196_247);
        poolB.setLiquidity(0);

        oracle = new CompositeTwapOracle(
            address(poolA),
            DREAMS,
            DREAMS_DECIMALS,
            address(poolB),
            WETH,
            USDC,
            WETH_DECIMALS,
            TWAP_WINDOW,
            0,
            1e10, // minLiquidityB = 1e10, pool has 0
            OWNER
        );

        PriceData memory data = oracle.getPrice();
        assertFalse(data.valid);
    }

    function test_bridgeInverse_poolB() public {
        // poolB with USDC=token0, WETH=token1 (inverted ordering)
        MockCLPool poolBInv = new MockCLPool(USDC, WETH, 1e18);
        CompositeTwapOracle oracleInv = new CompositeTwapOracle(
            address(poolA),
            DREAMS,
            DREAMS_DECIMALS,
            address(poolBInv),
            WETH,
            USDC,
            WETH_DECIMALS,
            TWAP_WINDOW,
            0,
            0,
            OWNER
        );
        assertFalse(oracleInv.bridgeIsToken0InB());

        _setTick(poolA, -104_140);
        _setTick(poolBInv, 196_247);

        PriceData memory data = oracleInv.getPrice();
        assertTrue(data.valid);
        assertGt(data.price, 0);
    }

    function test_invalidWhenPoolBObserveReverts() public {
        _setTick(poolA, -104_140);
        poolB.setObserveReverts(true);

        PriceData memory data = oracle.getPrice();
        assertFalse(data.valid);
    }

    function test_invalidWhenPoolAObserveReverts() public {
        poolA.setObserveReverts(true);
        _setTick(poolB, 80_068);

        PriceData memory data = oracle.getPrice();
        assertFalse(data.valid);
    }

    function test_tokenInverse_poolA() public {
        // poolA with WETH=token0, DREAMS=token1 (inverted ordering)
        MockCLPool poolAInv = new MockCLPool(WETH, DREAMS, 1e18);
        CompositeTwapOracle oracleInv = new CompositeTwapOracle(
            address(poolAInv),
            DREAMS,
            DREAMS_DECIMALS,
            address(poolB),
            WETH,
            USDC,
            WETH_DECIMALS,
            TWAP_WINDOW,
            0,
            0,
            OWNER
        );
        assertFalse(oracleInv.tokenIsToken0InA());

        // Set same tick — in inverted pool tick encodes DREAMS/WETH ratio (inverted from A)
        // tick -104140 in inverted pool means DREAMS_raw/WETH_raw = 1.0001^-104140
        // We want WETH/DREAMS = 1/ratio, so the oracle should invert and give same priceA
        int24 tickA = -104_140;
        _setTick(poolAInv, tickA);
        _setTick(poolB, 80_068);

        PriceData memory data = oracleInv.getPrice();
        assertTrue(data.valid);
        // Inverted pool with same tick: priceA = scaler * 2^192 / ratioX192
        uint256 ratioX192 = _tickToRatioX192(tickA);
        uint256 expectedA = FullMath.mulDiv(1e18, 1 << 192, ratioX192);
        uint256 expectedB = _expectedPriceB(80_068);
        uint256 expected = FullMath.mulDiv(expectedA, expectedB, 1e18);
        assertEq(data.price, expected);
    }

    function test_negativeTickRoundsTowardNegativeInfinity() public {
        // Set a tickCumulative delta that is negative and NOT an even multiple of the window,
        // exercising the round-towards-negative-infinity adjustment in _twapPrice.
        int56 windowI = int56(uint56(TWAP_WINDOW));
        // delta = -104_140 * window - 1  => not divisible, negative
        poolA.setTickCumulatives(0, int56(-104_140) * windowI - 1);
        _setTick(poolB, -196_247);

        PriceData memory data = oracle.getPrice();
        assertTrue(data.valid);
        assertGt(data.price, 0);
    }

    function test_getTwapWindow() public view {
        assertEq(oracle.getTwapWindow(), TWAP_WINDOW);
    }

    function test_ownerCanSetParams() public {
        vm.prank(OWNER);
        oracle.setTwapWindow(1800);
        assertEq(oracle.twapWindow(), 1800);

        vm.prank(OWNER);
        oracle.setMinLiquidityA(500);
        assertEq(oracle.minLiquidityA(), 500);

        vm.prank(OWNER);
        oracle.setMinLiquidityB(1000);
        assertEq(oracle.minLiquidityB(), 1000);
    }

    function test_liquidityReportsWeakerLeg() public {
        poolA.setLiquidity(500);
        poolB.setLiquidity(1000);
        _setTick(poolA, -104_140);
        _setTick(poolB, 80_068);

        PriceData memory data = oracle.getPrice();
        assertEq(data.liquidity, 500); // poolA is weaker
    }

    // -------------------------------------------------------------------------
    // Additional branch-coverage tests
    // -------------------------------------------------------------------------

    function test_setTwapWindow_zero_reverts() public {
        vm.prank(OWNER);
        vm.expectRevert(CompositeTwapOracle.TwapWindowZero.selector);
        oracle.setTwapWindow(0);
    }

    // tick = 500_000 → sqrtPriceX96 > uint128.max → exercises the high-path in _twapPrice.
    // tokenIsToken0InA = true (DREAMS=token0) so baseIsToken0=true in poolA.
    function test_extremeTick_highSqrtPath_baseIsToken0() public {
        _setTick(poolA, 500_000);
        _setTick(poolB, 80_068);
        PriceData memory data = oracle.getPrice();
        assertTrue(data.valid);
        assertGt(data.price, 0);
    }

    // Same extreme tick but with token as token1 in poolA (baseIsToken0=false).
    function test_extremeTick_highSqrtPath_baseIsToken1() public {
        // Build an oracle where DREAMS is token1 in poolA (tokenIsToken0InA=false).
        MockCLPool poolAInverse = new MockCLPool(WETH, DREAMS, 1e18);
        CompositeTwapOracle oracleInverse = new CompositeTwapOracle(
            address(poolAInverse),
            DREAMS,
            DREAMS_DECIMALS,
            address(poolB),
            WETH,
            USDC,
            WETH_DECIMALS,
            TWAP_WINDOW,
            0,
            0,
            OWNER
        );
        assertFalse(oracleInverse.tokenIsToken0InA());

        // extreme positive tick: avgTick = 500_000 → sqrtPriceX96 > uint128.max
        int56 delta = int56(500_000) * int56(uint56(TWAP_WINDOW));
        poolAInverse.setTickCumulatives(0, delta);
        _setTick(poolB, 80_068);

        PriceData memory data = oracleInverse.getPrice();
        // Price may be extremely small (inverted high ratio) but should not revert.
        // valid depends on whether final price rounds to zero — just verify no revert.
        assertTrue(data.price > 0 || !data.valid);
    }

    // tick = MIN_TICK for poolA → sqrtPriceX96 is minimal → priceA rounds to zero → valid=false.
    function test_getPrice_zeroPriceA_returnsInvalid() public {
        _setTick(poolA, -887_272);
        _setTick(poolB, 80_068);
        PriceData memory data = oracle.getPrice();
        assertFalse(data.valid);
        assertEq(data.price, 0);
    }

    // tick = 0 for poolA (priceA > 0), MIN_TICK for poolB → priceB rounds to zero → valid=false.
    function test_getPrice_zeroPriceB_returnsInvalid() public {
        _setTick(poolA, 0);
        _setTick(poolB, -887_272);
        PriceData memory data = oracle.getPrice();
        assertFalse(data.valid);
        assertEq(data.price, 0);
    }
}
