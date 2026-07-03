// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal mock of an Aerodrome CL pool for oracle testing.
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
