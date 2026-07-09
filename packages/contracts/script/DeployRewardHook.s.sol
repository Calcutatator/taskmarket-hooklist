// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { RewardVault } from "../src/hooks/RewardVault.sol";
import { EpochBudget } from "../src/hooks/EpochBudget.sol";
import { TaskTokenRewardHook } from "../src/hooks/TaskTokenRewardHook.sol";

interface IDiamondAdmin {
    function setDefaultHooks(address[] calldata hooks) external;
}

/// @dev Required env vars (set in packages/contracts/.env):
///
///   FORGE_DEV_PRIVATE_KEY            — deployer/owner key
///   FORGE_PROTOCOL_TOKEN             — DREAMS token address
///   FORGE_DIAMOND_ADDRESS            — TaskMarket Diamond proxy
///   FORGE_DREAMS_PER_USDC            — whole DREAMS per $1 (e.g. 347); scaled by 1e18 in this script
///   FORGE_EPOCH_DURATION             — epoch length in seconds (e.g. 604800 = 7 days)
///   FORGE_GLOBAL_EPOCH_CAP_USD       — max USD-value emitted per epoch (USDC base units)
///   FORGE_WORKER_CAP_USD             — per-worker per-epoch cap (USDC base units)
///   FORGE_REQUESTER_CAP_USD          — per-requester per-epoch cap (USDC base units)
///   FORGE_MAX_USD_PER_TASK           — per-task emission cap (USDC base units)
///
///   FORGE_WORKER_SPLIT_BPS           — worker share in bps (e.g. 8000 = 80%; default 8000)
///   FORGE_BACKEND_ADDRESS            — backend server wallet address (trusted for withdrawFor)
///
///   Optional:
///     FORGE_INITIAL_VAULT_BALANCE    — tokens to seed vault with (wei)
contract DeployRewardHook is Script {
    using SafeERC20 for IERC20;

    function run() external {
        uint256 deployerKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);

        (RewardVault vault, EpochBudget budget) = _deployCore(deployer);
        TaskTokenRewardHook hook = _deployHook(vault, budget, deployer);

        vault.setHook(address(hook));
        budget.setHook(address(hook));

        // Register hook as the protocol default so every new task on the Diamond triggers it.
        // This replaces any existing default-hook list — preserve the old list by reading
        // getDefaultHooks() first if other hooks must be retained alongside this one.
        address[] memory defaultHooks = new address[](1);
        defaultHooks[0] = address(hook);
        IDiamondAdmin(vm.envAddress("FORGE_DIAMOND_ADDRESS")).setDefaultHooks(defaultHooks);

        uint256 initialVaultBalance = vm.envOr("FORGE_INITIAL_VAULT_BALANCE", uint256(0));
        if (initialVaultBalance > 0) {
            IERC20(vm.envAddress("FORGE_PROTOCOL_TOKEN")).safeTransfer(address(vault), initialVaultBalance);
        }

        vm.stopBroadcast();

        console.log("=== TaskTokenRewardHook deployment ===");
        console.log("RewardVault:          ", address(vault));
        console.log("EpochBudget:          ", address(budget));
        console.log("TaskTokenRewardHook:  ", address(hook));
        console.log("Vault seeded (wei):   ", initialVaultBalance);
        console.log("Diamond default hooks: set to [TaskTokenRewardHook]");
    }

    function _deployCore(address deployer) internal returns (RewardVault vault, EpochBudget budget) {
        address protocolToken = vm.envAddress("FORGE_PROTOCOL_TOKEN");
        vault = new RewardVault(protocolToken, deployer);
        budget = new EpochBudget(
            vm.envUint("FORGE_EPOCH_DURATION"),
            vm.envUint("FORGE_GLOBAL_EPOCH_CAP_USD"),
            vm.envUint("FORGE_WORKER_CAP_USD"),
            vm.envUint("FORGE_REQUESTER_CAP_USD"),
            vm.envUint("FORGE_MAX_USD_PER_TASK"),
            deployer
        );
    }

    function _deployHook(RewardVault vault, EpochBudget budget, address deployer)
        internal
        returns (TaskTokenRewardHook hook)
    {
        address protocolToken = vm.envAddress("FORGE_PROTOCOL_TOKEN");
        uint256 dreamsPerUsdc = vm.envUint("FORGE_DREAMS_PER_USDC") * 1e18;
        hook = new TaskTokenRewardHook(
            address(vault),
            address(budget),
            vm.envAddress("FORGE_DIAMOND_ADDRESS"),
            IERC20Metadata(protocolToken).decimals(),
            dreamsPerUsdc,
            protocolToken,
            uint16(vm.envOr("FORGE_WORKER_SPLIT_BPS", uint256(8000))),
            vm.envAddress("FORGE_BACKEND_ADDRESS"),
            deployer
        );
    }
}
