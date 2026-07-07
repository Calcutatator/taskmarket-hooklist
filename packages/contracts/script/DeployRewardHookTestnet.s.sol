// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RewardVault } from "../src/hooks/RewardVault.sol";
import { EpochBudget } from "../src/hooks/EpochBudget.sol";
import { TaskTokenRewardHook } from "../src/hooks/TaskTokenRewardHook.sol";
import { MockOracle } from "../src/mocks/MockOracle.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

interface IDiamondAdmin {
    function setDefaultHooks(address[] calldata hooks) external;
}

/// @notice Testnet deployment of the token reward hook stack using mock oracle and mock token.
///         Use for smoke-testing only. Not suitable for mainnet.
///
/// Required env vars:
///   FORGE_DEV_PRIVATE_KEY        — deployer/owner key
///   FORGE_DIAMOND_ADDRESS        — TaskMarket Diamond proxy on testnet
///
/// Optional:
///   FORGE_MOCK_TOKEN_PRICE       — DREAMS/USD price in 1e18 (default: 0.09e18 = $0.09)
///   FORGE_INITIAL_VAULT_BALANCE  — mock DREAMS tokens to mint into vault (default: 1_000_000e18)
///   FORGE_EPOCH_DURATION         — seconds (default: 604800 = 7 days)
///   FORGE_GLOBAL_EPOCH_CAP       — wei (default: 100_000e18)
///   FORGE_WORKER_CAP             — wei (default: 10_000e18)
///   FORGE_REQUESTER_CAP          — wei (default: 50_000e18)
///   FORGE_MAX_TOKENS_PER_TASK    — wei (default: 5_000e18)
///   FORGE_DRIFT_BAND_BPS         — bps (default: 2000 = 20%)
///   FORGE_WORKER_SPLIT_BPS       — worker share in bps (default: 8000 = 80%)
///   FORGE_BACKEND_ADDRESS        — backend server wallet (defaults to deployer for testnet)
contract DeployRewardHookTestnet is Script {
    uint8 constant TOKEN_DECIMALS = 18;

    function run() external {
        uint256 deployerKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);

        MockERC20 token = new MockERC20("Mock DREAMS", "mDREAMS", TOKEN_DECIMALS, deployer);
        MockOracle oracle = new MockOracle(vm.envOr("FORGE_MOCK_TOKEN_PRICE", uint256(0.09e18)), deployer);
        RewardVault vault = new RewardVault(address(token), deployer);
        EpochBudget budget = new EpochBudget(
            vm.envOr("FORGE_EPOCH_DURATION", uint256(604_800)),
            vm.envOr("FORGE_GLOBAL_EPOCH_CAP", uint256(100_000e18)),
            vm.envOr("FORGE_WORKER_CAP", uint256(10_000e18)),
            vm.envOr("FORGE_REQUESTER_CAP", uint256(50_000e18)),
            vm.envOr("FORGE_MAX_TOKENS_PER_TASK", uint256(5_000e18)),
            deployer
        );
        TaskTokenRewardHook hook = new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            vm.envAddress("FORGE_DIAMOND_ADDRESS"),
            TOKEN_DECIMALS,
            uint16(vm.envOr("FORGE_DRIFT_BAND_BPS", uint256(2000))),
            address(token),
            uint16(vm.envOr("FORGE_WORKER_SPLIT_BPS", uint256(8000))),
            vm.envOr("FORGE_BACKEND_ADDRESS", deployer),
            deployer
        );

        vault.setHook(address(hook));
        budget.setHook(address(hook));

        uint256 vaultSeed = vm.envOr("FORGE_INITIAL_VAULT_BALANCE", uint256(1_000_000e18));
        token.mint(address(vault), vaultSeed);

        // Bypass wallet-age ramp for testnet so new wallets earn full rewards immediately.
        // Thresholds are 1/2/3 seconds; multipliers are all 10000 bps (100%).
        uint40[3] memory rampThresholds = [uint40(1), uint40(2), uint40(3)];
        uint16[4] memory rampMultipliers = [uint16(10000), uint16(10000), uint16(10000), uint16(10000)];
        hook.setRamp(rampThresholds, rampMultipliers);

        address[] memory defaultHooks = new address[](1);
        defaultHooks[0] = address(hook);
        IDiamondAdmin(vm.envAddress("FORGE_DIAMOND_ADDRESS")).setDefaultHooks(defaultHooks);

        vm.stopBroadcast();

        console.log("=== TokenRewardHook testnet deployment (mock) ===");
        console.log("MockERC20 (mDREAMS):  ", address(token));
        console.log("MockOracle:           ", address(oracle));
        console.log("RewardVault:          ", address(vault));
        console.log("EpochBudget:          ", address(budget));
        console.log("TaskTokenRewardHook:  ", address(hook));
        console.log("Vault seeded (wei):   ", vaultSeed);
        console.log("Diamond default hooks: set to [TaskTokenRewardHook]");
    }
}
