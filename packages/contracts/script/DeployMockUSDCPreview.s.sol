// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

/// @title DeployMockUSDCPreview — mint a mock USDC on a disposable per-PR Anvil chain
/// @dev Only for the ephemeral preview-environment flow (docs/specs/agent-preview-environments-rfc.md).
///      A fresh Anvil chain has no USDC deployed, unlike Base Sepolia/Base, so DiamondDeploy's
///      required FORGE_USDC_TOKEN_ADDRESS has nothing to point at without this.
/// @dev Required env vars:
///      FORGE_DEV_PRIVATE_KEY — deployer key (an Anvil default dev account in this flow)
contract DeployMockUSDCPreview is Script {
    uint8 constant USDC_DECIMALS = 6;
    uint256 constant MINT_AMOUNT = 1_000_000_000 * 10 ** USDC_DECIMALS; // 1B mock USDC

    function run() external {
        uint256 deployerKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        MockERC20 usdc = new MockERC20("Mock USDC", "mUSDC", USDC_DECIMALS, deployer);
        usdc.mint(deployer, MINT_AMOUNT);
        vm.stopBroadcast();

        console.log("Mock USDC deployed at:", address(usdc));
    }
}
