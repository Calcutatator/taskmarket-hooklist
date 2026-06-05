// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { CompositeTwapOracle } from "../src/oracle/CompositeTwapOracle.sol";
import { RewardVault } from "../src/hooks/RewardVault.sol";
import { EpochBudget } from "../src/hooks/EpochBudget.sol";
import { TaskTokenRewardHook } from "../src/hooks/TaskTokenRewardHook.sol";

/// @dev Required env vars (set in packages/contracts/.env):
///
///   FORGE_DEV_PRIVATE_KEY            — deployer/owner key
///   FORGE_PROTOCOL_TOKEN             — DREAMS token address
///   FORGE_AERODROME_POOL             — TOKEN/WETH Aerodrome CL pool (leg A)
///   FORGE_WETH_USDC_POOL             — WETH/USDC Aerodrome CL pool (leg B)
///   FORGE_DIAMOND_ADDRESS            — TaskMarket Diamond proxy
///   FORGE_TWAP_WINDOW                — TWAP window in seconds (e.g. 3600)
///   FORGE_MIN_LIQUIDITY_A            — min in-range liquidity for poolA
///   FORGE_MIN_LIQUIDITY_B            — min in-range liquidity for poolB
///   FORGE_MAX_STALENESS              — max seconds since last observation (e.g. 3600)
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
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    uint8 constant WETH_DECIMALS = 18;

    function run() external {
        uint256 deployerKey = vm.envUint("FORGE_DEV_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address protocolToken = vm.envAddress("FORGE_PROTOCOL_TOKEN");
        address poolA = vm.envAddress("FORGE_AERODROME_POOL");
        address poolB = vm.envAddress("FORGE_WETH_USDC_POOL");
        address diamondAddress = vm.envAddress("FORGE_DIAMOND_ADDRESS");
        address weth = vm.envOr("FORGE_WETH_ADDRESS", BASE_WETH);

        uint32 twapWindow = uint32(vm.envUint("FORGE_TWAP_WINDOW"));
        uint256 minLiquidityA = vm.envUint("FORGE_MIN_LIQUIDITY_A");
        uint256 minLiquidityB = vm.envUint("FORGE_MIN_LIQUIDITY_B");
        uint256 maxStaleness = vm.envUint("FORGE_MAX_STALENESS");
        uint256 epochDuration = vm.envUint("FORGE_EPOCH_DURATION");
        uint256 globalCap = vm.envUint("FORGE_GLOBAL_EPOCH_CAP");
        uint256 workerCap = vm.envUint("FORGE_WORKER_CAP");
        uint256 requesterCap = vm.envUint("FORGE_REQUESTER_CAP");
        uint256 maxTokensPerTask = vm.envUint("FORGE_MAX_TOKENS_PER_TASK");
        uint16 driftBandBps = uint16(vm.envUint("FORGE_DRIFT_BAND_BPS"));
        uint256 initialVaultBalance = vm.envOr("FORGE_INITIAL_VAULT_BALANCE", uint256(0));

        uint8 tokenDecimals = IERC20Metadata(protocolToken).decimals();

        vm.startBroadcast(deployerKey);

        // 1. Composite oracle: TOKEN/WETH * WETH/USDC -> USDC per TOKEN
        CompositeTwapOracle oracle = new CompositeTwapOracle(
            poolA,
            protocolToken,
            tokenDecimals,
            poolB,
            weth,
            WETH_DECIMALS,
            twapWindow,
            minLiquidityA,
            minLiquidityB,
            maxStaleness,
            deployer
        );

        // 2. Vault
        RewardVault vault = new RewardVault(protocolToken, deployer);

        // 3. Epoch budget
        EpochBudget budget =
            new EpochBudget(epochDuration, globalCap, workerCap, requesterCap, maxTokensPerTask, deployer);

        // 4. Hook
        TaskTokenRewardHook hook = new TaskTokenRewardHook(
            address(oracle), address(vault), address(budget), diamondAddress, tokenDecimals, driftBandBps, deployer
        );

        // 5. Wire permissions
        vault.setHook(address(hook));
        budget.setHook(address(hook));

        // 6. Seed vault if configured
        if (initialVaultBalance > 0) {
            IERC20(protocolToken).transfer(address(vault), initialVaultBalance);
        }

        vm.stopBroadcast();

        console.log("=== TaskTokenRewardHook deployment ===");
        console.log("CompositeTwapOracle:  ", address(oracle));
        console.log("  poolA (TOKEN/WETH): ", poolA);
        console.log("  poolB (WETH/USDC):  ", poolB);
        console.log("RewardVault:          ", address(vault));
        console.log("EpochBudget:          ", address(budget));
        console.log("TaskTokenRewardHook:  ", address(hook));
        console.log("Token decimals:       ", tokenDecimals);
        console.log("TWAP window (s):      ", twapWindow);
        console.log("Drift band bps:       ", driftBandBps);
        console.log("Vault seeded (wei):   ", initialVaultBalance);
    }
}
