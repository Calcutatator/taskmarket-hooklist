// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CompositeTwapOracle } from "../src/oracle/CompositeTwapOracle.sol";
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
///   FORGE_AERODROME_POOL             — TOKEN/WETH Aerodrome CL pool (leg A)
///   FORGE_WETH_USDC_POOL             — WETH/USDC Aerodrome CL pool (leg B)
///   FORGE_USDC_ADDRESS               — USDC token address
///   FORGE_DIAMOND_ADDRESS            — TaskMarket Diamond proxy
///   FORGE_TWAP_WINDOW                — TWAP window in seconds (e.g. 3600)
///   FORGE_MIN_LIQUIDITY_A            — min in-range liquidity for poolA
///   FORGE_MIN_LIQUIDITY_B            — min in-range liquidity for poolB
///   FORGE_EPOCH_DURATION             — epoch length in seconds (e.g. 604800 = 7 days)
///   FORGE_GLOBAL_EPOCH_CAP           — max tokens emitted per epoch (wei)
///   FORGE_WORKER_CAP                 — per-worker per-epoch cap (wei)
///   FORGE_REQUESTER_CAP              — per-requester per-epoch cap (wei)
///   FORGE_MAX_TOKENS_PER_TASK        — per-task emission cap (wei)
///   FORGE_DRIFT_BAND_BPS             — price drift tolerance in bps (e.g. 2000 = 20%)
///
///   Optional:
///     FORGE_WETH_ADDRESS             — defaults to Base canonical WETH
///     FORGE_INITIAL_VAULT_BALANCE    — tokens to seed vault with (wei)
contract DeployRewardHook is Script {
    using SafeERC20 for IERC20;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    uint8 constant WETH_DECIMALS = 18;

    function run() external {
        uint256 deployerKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);

        (CompositeTwapOracle oracle, RewardVault vault, EpochBudget budget) = _deployCore(deployer);
        TaskTokenRewardHook hook = _deployHook(oracle, vault, budget, deployer);

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
        console.log("CompositeTwapOracle:  ", address(oracle));
        console.log("RewardVault:          ", address(vault));
        console.log("EpochBudget:          ", address(budget));
        console.log("TaskTokenRewardHook:  ", address(hook));
        console.log("Vault seeded (wei):   ", initialVaultBalance);
        console.log("Diamond default hooks: set to [TaskTokenRewardHook]");
    }

    function _deployCore(address deployer)
        internal
        returns (CompositeTwapOracle oracle, RewardVault vault, EpochBudget budget)
    {
        address protocolToken = vm.envAddress("FORGE_PROTOCOL_TOKEN");
        oracle = new CompositeTwapOracle(
            vm.envAddress("FORGE_AERODROME_POOL"),
            protocolToken,
            IERC20Metadata(protocolToken).decimals(),
            vm.envAddress("FORGE_WETH_USDC_POOL"),
            vm.envOr("FORGE_WETH_ADDRESS", BASE_WETH),
            vm.envAddress("FORGE_USDC_ADDRESS"),
            WETH_DECIMALS,
            uint32(vm.envUint("FORGE_TWAP_WINDOW")),
            vm.envUint("FORGE_MIN_LIQUIDITY_A"),
            vm.envUint("FORGE_MIN_LIQUIDITY_B"),
            deployer
        );
        vault = new RewardVault(protocolToken, deployer);
        budget = new EpochBudget(
            vm.envUint("FORGE_EPOCH_DURATION"),
            vm.envUint("FORGE_GLOBAL_EPOCH_CAP"),
            vm.envUint("FORGE_WORKER_CAP"),
            vm.envUint("FORGE_REQUESTER_CAP"),
            vm.envUint("FORGE_MAX_TOKENS_PER_TASK"),
            deployer
        );
    }

    function _deployHook(CompositeTwapOracle oracle, RewardVault vault, EpochBudget budget, address deployer)
        internal
        returns (TaskTokenRewardHook hook)
    {
        address protocolToken = vm.envAddress("FORGE_PROTOCOL_TOKEN");
        hook = new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            vm.envAddress("FORGE_DIAMOND_ADDRESS"),
            IERC20Metadata(protocolToken).decimals(),
            uint16(vm.envUint("FORGE_DRIFT_BAND_BPS")),
            deployer
        );
    }
}
