// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITokenUsdOracle, PriceData } from "../interfaces/ITokenUsdOracle.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test/testnet oracle that returns a manually configured price.
///         Do not deploy to mainnet.
contract MockOracle is ITokenUsdOracle, Ownable {
    PriceData private _price;

    constructor(uint256 price, address owner) Ownable(owner) {
        _price = PriceData({ price: price, twapWindow: 3600, liquidity: 1e18, updatedAt: block.timestamp, valid: true });
    }

    function getPrice() external view returns (PriceData memory) {
        return _price;
    }

    function getTwapWindow() external view returns (uint32) {
        return _price.twapWindow;
    }

    function setPrice(uint256 price) external onlyOwner {
        _price.price = price;
        _price.updatedAt = block.timestamp;
    }

    function setValid(bool valid) external onlyOwner {
        _price.valid = valid;
    }
}
