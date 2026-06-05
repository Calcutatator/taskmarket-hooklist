// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct PriceData {
    uint256 price; // USD price of 1 whole TOKEN, scaled to 1e18 (i.e. USDC per TOKEN)
    uint32 twapWindow; // seconds used for this observation
    uint256 liquidity; // pool in-range liquidity at observation time
    uint256 updatedAt; // block.timestamp of this call
    bool valid; // false if oracle cannot produce a reliable price
}

interface ITokenUsdOracle {
    function getPrice() external view returns (PriceData memory);
    function getTwapWindow() external view returns (uint32);
}
