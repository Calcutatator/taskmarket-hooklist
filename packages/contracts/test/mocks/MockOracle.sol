// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITokenUsdOracle, PriceData } from "../../src/interfaces/ITokenUsdOracle.sol";

contract MockOracle is ITokenUsdOracle {
    PriceData public mockPrice;

    constructor(uint256 price) {
        mockPrice =
            PriceData({ price: price, twapWindow: 3600, liquidity: 1e18, updatedAt: block.timestamp, valid: true });
    }

    function getPrice() external view returns (PriceData memory) {
        return mockPrice;
    }

    function getTwapWindow() external pure returns (uint32) {
        return 3600;
    }

    function setPrice(uint256 price) external {
        mockPrice.price = price;
        mockPrice.updatedAt = block.timestamp;
    }

    function setValid(bool valid) external {
        mockPrice.valid = valid;
    }
}
