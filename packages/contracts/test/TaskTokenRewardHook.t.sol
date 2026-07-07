// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { ITMPCore } from "../src/interfaces/ITMPCore.sol";
import { ITMPHook } from "../src/interfaces/ITMPHook.sol";
import { PriceData } from "../src/interfaces/ITokenUsdOracle.sol";
import "./mocks/MockOracle.sol";
import { TaskTokenRewardHook } from "../src/hooks/TaskTokenRewardHook.sol";
import { RewardVault } from "../src/hooks/RewardVault.sol";
import { EpochBudget } from "../src/hooks/EpochBudget.sol";
import { DiamondTestHelper } from "./helpers/DiamondTestHelper.sol";
import { ITMPDiamond } from "../src/interfaces/ITMPDiamond.sol";
import "./mocks/MockPGTRForwarder.sol";
import "./mocks/MockUSDC.sol";
// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

contract TaskTokenRewardHookTest is DiamondTestHelper {
    // price = USDC per 1 DREAMS, 1e18 scaled. $0.10 per DREAMS => 1e17.
    uint256 constant PRICE_DREAMS_USD = 1e17;
    // $100 USDC reward = 100 * 1e6 (6 decimals)
    uint256 constant REWARD_100_USDC = 100 * 1e6;
    // expected token reward at full rate: rewardUsd * 10^(18+12) / price = 100e6 * 1e30 / 1e17 = 1000 DREAMS
    uint256 constant EXPECTED_REWARD_1000_DREAMS = 1000 * 1e18;

    uint256 constant EPOCH_DURATION = 7 days;
    uint256 constant GLOBAL_CAP = 1_000_000 * 1e18;
    uint256 constant WORKER_CAP = 100_000 * 1e18;
    uint256 constant REQUESTER_CAP = 500_000 * 1e18;
    uint256 constant MAX_PER_TASK = 10_000 * 1e18;
    uint16 constant DRIFT_BPS = 2000; // 20%
    uint16 constant WORKER_SPLIT_BPS = 10_000; // setUp uses 100% worker for backward compat

    ITMPDiamond market;
    MockPGTRForwarder forwarder;
    MockUSDC usdc;
    MockUSDC dreamsToken;

    MockOracle oracle;
    RewardVault vault;
    EpochBudget budget;
    TaskTokenRewardHook hook;

    address owner = makeAddr("owner");
    address backend = makeAddr("backend");
    address requester = makeAddr("requester");
    address worker = makeAddr("worker");
    address feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        vm.startPrank(owner);

        usdc = new MockUSDC();
        dreamsToken = new MockUSDC(); // 18-decimal mock for DREAMS

        market = deployDiamond(owner, address(usdc), feeRecipient, 500);

        forwarder = new MockPGTRForwarder(address(usdc));
        market.addForwarder(address(forwarder));

        oracle = new MockOracle(PRICE_DREAMS_USD);
        vault = new RewardVault(address(dreamsToken), owner);
        budget = new EpochBudget(EPOCH_DURATION, GLOBAL_CAP, WORKER_CAP, REQUESTER_CAP, MAX_PER_TASK, owner);
        hook = new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            address(market),
            18,
            DRIFT_BPS,
            address(dreamsToken),
            WORKER_SPLIT_BPS,
            backend,
            owner
        );

        vault.setHook(address(hook));
        budget.setHook(address(hook));

        // Use bypass ramp (age=0 gets full rate) so existing tests are not affected by the
        // default 2/4/8-week ramp. Ramp-specific tests override via setRamp().
        hook.setRamp(
            [uint40(1), uint40(2), uint40(3)], [uint16(10_000), uint16(10_000), uint16(10_000), uint16(10_000)]
        );

        // Fund vault with 100k DREAMS
        dreamsToken.mint(owner, 100_000 * 1e18);
        dreamsToken.transfer(address(vault), 100_000 * 1e18);

        vm.stopPrank();

        // Forwarder holds USDC on behalf of payers
        usdc.mint(address(forwarder), 10_000 * 1e6);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _relay(address sender, uint256 amount, bytes memory data) internal returns (bytes memory) {
        return forwarder.relay(address(market), sender, amount, data);
    }

    function _createClaimTask() internal returns (bytes32 taskId) {
        bytes memory result = _relay(
            requester,
            REWARD_100_USDC,
            abi.encodeCall(
                market.createTask,
                (
                    REWARD_100_USDC,
                    1 days,
                    market.CLAIM(),
                    0,
                    0,
                    bytes4(0),
                    ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                    ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
                )
            )
        );
        taskId = abi.decode(result, (bytes32));
    }

    function _createBountyTask() internal returns (bytes32 taskId) {
        bytes memory result = _relay(
            requester,
            REWARD_100_USDC,
            abi.encodeCall(
                market.createTask,
                (
                    REWARD_100_USDC,
                    1 days,
                    market.BOUNTY(),
                    0,
                    0,
                    bytes4(0),
                    ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                    ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
                )
            )
        );
        taskId = abi.decode(result, (bytes32));
    }

    function _createLongClaimTask() internal returns (bytes32 taskId) {
        bytes memory result = _relay(
            requester,
            REWARD_100_USDC,
            abi.encodeCall(
                market.createTask,
                (
                    REWARD_100_USDC,
                    365 days,
                    market.CLAIM(),
                    0,
                    0,
                    bytes4(0),
                    ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                    ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
                )
            )
        );
        taskId = abi.decode(result, (bytes32));
    }

    function _hookArr(address h) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = h;
    }

    // ─── ERC-165 ──────────────────────────────────────────────────────────────

    function test_supportsInterface() public view {
        assertTrue(hook.supportsInterface(type(ITMPHook).interfaceId));
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
        assertFalse(hook.supportsInterface(bytes4(0xdeadbeef)));
    }

    // ─── Constructor validation ───────────────────────────────────────────────

    function test_constructor_driftBandTooHigh_reverts() public {
        vm.expectRevert(TaskTokenRewardHook.DriftBandBpsTooHigh.selector);
        new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            address(market),
            18,
            10_000,
            address(dreamsToken),
            WORKER_SPLIT_BPS,
            backend,
            owner
        );
    }

    function test_constructor_zeroOracle_reverts() public {
        vm.expectRevert(TaskTokenRewardHook.OracleInvalid.selector);
        new TaskTokenRewardHook(
            address(0),
            address(vault),
            address(budget),
            address(market),
            18,
            DRIFT_BPS,
            address(dreamsToken),
            WORKER_SPLIT_BPS,
            backend,
            owner
        );
    }

    function test_constructor_revertsIfTokenZero() public {
        vm.expectRevert(TaskTokenRewardHook.OracleInvalid.selector);
        new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            address(market),
            18,
            DRIFT_BPS,
            address(0),
            WORKER_SPLIT_BPS,
            backend,
            owner
        );
    }

    function test_constructor_revertsIfBpsOver10000() public {
        vm.expectRevert(TaskTokenRewardHook.InvalidBps.selector);
        new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            address(market),
            18,
            DRIFT_BPS,
            address(dreamsToken),
            10_001,
            backend,
            owner
        );
    }

    function test_constructor_revertsIfBackendZero() public {
        vm.expectRevert(TaskTokenRewardHook.OracleInvalid.selector);
        new TaskTokenRewardHook(
            address(oracle),
            address(vault),
            address(budget),
            address(market),
            18,
            DRIFT_BPS,
            address(dreamsToken),
            WORKER_SPLIT_BPS,
            address(0),
            owner
        );
    }

    // ─── Claim mode happy path ─────────────────────────────────────────────────

    function test_claimMode_fullHappyPath() public {
        bytes32 taskId = _createClaimTask();

        // Verify state stored
        (uint256 rewardUsd,,,,, address req,, bool reserved, bool paid) = hook.rewardStates(taskId);
        assertEq(rewardUsd, REWARD_100_USDC);
        assertEq(req, requester);
        assertFalse(reserved);
        assertFalse(paid);

        // Worker claims — price locks, tokens reserved
        uint256 vaultBefore = vault.available();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        (, uint256 startPrice,,, uint256 reservedAmt,, address lockedWorker, bool res,) = hook.rewardStates(taskId);
        assertEq(startPrice, PRICE_DREAMS_USD);
        assertEq(lockedWorker, worker);
        assertTrue(res);
        // max reserved = rewardUsd * 1e30 / minSettlePrice = 100e6 * 1e30 / (1e17 * 0.8) = 1250 DREAMS
        assertEq(reservedAmt, 1250 * 1e18);
        assertLt(vault.available(), vaultBefore);

        // Worker submits
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        // Requester accepts — hook credits tokens to claimable (100% worker split in setUp)
        uint256 workerClaimableBefore = hook.claimable(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 workerClaimableAfter = hook.claimable(worker);
        // 100e6 * 1e30 / 1e17 = 1000 DREAMS (full rate from bypass ramp, 100% split)
        assertEq(workerClaimableAfter - workerClaimableBefore, EXPECTED_REWARD_1000_DREAMS);
        // Worker wallet balance unchanged — tokens are in hook escrow
        assertEq(dreamsToken.balanceOf(worker), 0);
        // Unused reserve (1250 - 1000 = 250) released back to available pool
        assertEq(vault.taskReserve(taskId), 0);

        // Verify paid flag
        (,,,,,,,, bool paid2) = hook.rewardStates(taskId);
        assertTrue(paid2);
    }

    // ─── Bounty mode (Path B) ─────────────────────────────────────────────────

    function test_bountyMode_paysAtComplete() public {
        bytes32 taskId = _createBountyTask();

        // Worker submits (no checkClaim fires)
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = hook.claimable(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertGt(hook.claimable(worker), before);
        assertEq(dreamsToken.balanceOf(worker), 0);
    }

    // ─── Claimable escrow ─────────────────────────────────────────────────────

    function test_rewardsAccumulateInClaimable() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertGt(hook.claimable(worker), 0);
        assertEq(hook.totalClaimable(), hook.claimable(worker) + hook.claimable(requester));
        assertEq(dreamsToken.balanceOf(worker), 0);
    }

    function test_withdrawFor_happyPath() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 claimableAmt = hook.claimable(worker);
        assertGt(claimableAmt, 0);

        address destination = makeAddr("destination");
        vm.prank(backend);
        hook.withdrawFor(worker, destination);

        assertEq(dreamsToken.balanceOf(destination), claimableAmt);
        assertEq(hook.claimable(worker), 0);
        // totalClaimable decremented
        assertEq(hook.totalClaimable(), hook.claimable(requester));
    }

    function test_withdrawFor_revertsIfNotBackend() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        vm.expectRevert(TaskTokenRewardHook.NotBackend.selector);
        hook.withdrawFor(worker, worker);
    }

    function test_withdrawFor_revertsIfNothingToClaim() public {
        vm.prank(backend);
        vm.expectRevert(TaskTokenRewardHook.NothingToClaim.selector);
        hook.withdrawFor(worker, worker);
    }

    // ─── firstSeen ────────────────────────────────────────────────────────────

    function test_firstSeen_setOnCheckFund() public {
        assertEq(hook.firstSeen(requester), 0);
        _createClaimTask();
        assertGt(hook.firstSeen(requester), 0);
    }

    function test_firstSeen_setOnCheckClaim() public {
        bytes32 taskId = _createClaimTask();
        assertEq(hook.firstSeen(worker), 0);
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        assertGt(hook.firstSeen(worker), 0);
    }

    function test_firstSeen_neverOverwritten() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        uint40 seenFirst = hook.firstSeen(worker);
        assertGt(seenFirst, 0);

        // Submit and complete so worker can create another task
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // Fund forwarder and create a second task
        usdc.mint(address(forwarder), 10_000 * 1e6);
        vm.warp(block.timestamp + 1);
        bytes32 taskId2 = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId2, 0)));

        // firstSeen must not change
        assertEq(hook.firstSeen(worker), seenFirst);
    }

    function test_firstSeen_setForAuctionWorker() public {
        // checkSelectWorker fires for auction mode (same dispatch as pitch).
        // Call directly as the diamond to verify _touchFirstSeen runs.
        assertEq(hook.firstSeen(worker), 0);

        bytes32 taskId = _createClaimTask(); // need a seeded RewardState for _reserveForWorker
        vm.prank(address(market));
        ITMPCore.TaskContext memory ctx;
        ctx.requester = requester;
        hook.checkSelectWorker(taskId, ctx, worker);

        assertGt(hook.firstSeen(worker), 0);
    }

    function test_ageMultiplier_returnsZeroForNewWallet() public {
        // A wallet that has never interacted with the hook has firstSeen == 0 → multiplier 0.
        // Use the default ramp (restore it first).
        vm.prank(owner);
        hook.setRamp(
            [uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );

        bytes32 taskId = _createClaimTask(); // requester firstSeen set here
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        // worker firstSeen just set — age = 0 < 2 weeks → rampMultipliers[0] = 0
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // Worker age = 0 seconds → multiplier[0] = 0 → claimable = 0
        assertEq(hook.claimable(worker), 0);
    }

    // ─── Age ramp ─────────────────────────────────────────────────────────────

    // Helper: complete a claim task and return worker's claimable delta.
    function _runClaimTask(uint16 _workerSplitBps) internal returns (uint256 workerClaimed) {
        vm.prank(owner);
        hook.setWorkerSplitBps(_workerSplitBps);

        usdc.mint(address(forwarder), REWARD_100_USDC);
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("w"))));

        uint256 before = hook.claimable(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("w"), 0)));
        workerClaimed = hook.claimable(worker) - before;
    }

    function test_ageRamp_zeroBeforeTwoWeeks() public {
        // Restore default ramp
        vm.prank(owner);
        hook.setRamp(
            [uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );

        // Touch firstSeen now, then complete task immediately (age < 2 weeks)
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertEq(hook.claimable(worker), 0);
    }

    function test_ageRamp_quarterXBetweenTwoAndFourWeeks() public {
        vm.prank(owner);
        hook.setRamp(
            [uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );

        // Use a 365-day task so it doesn't expire during the warp.
        // Worker claims at T=0 (firstSeen set), then we warp into the 2–4 week window.
        usdc.mint(address(forwarder), REWARD_100_USDC);
        bytes32 taskId = _createLongClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        vm.warp(block.timestamp + 2 weeks + 1);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // 100% split to worker (setUp); 2500 bps = 25%: 1000 DREAMS * 0.25 = 250 DREAMS
        assertEq(hook.claimable(worker), 250 * 1e18);
    }

    function test_ageRamp_halfXBetweenFourAndEightWeeks() public {
        vm.prank(owner);
        hook.setRamp(
            [uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );

        usdc.mint(address(forwarder), REWARD_100_USDC);
        bytes32 taskId = _createLongClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        vm.warp(block.timestamp + 4 weeks + 1);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // 5000 bps = 50%: 1000 DREAMS * 0.5 = 500 DREAMS
        assertEq(hook.claimable(worker), 500 * 1e18);
    }

    function test_ageRamp_fullXAfterEightWeeks() public {
        vm.prank(owner);
        hook.setRamp(
            [uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );

        usdc.mint(address(forwarder), REWARD_100_USDC);
        bytes32 taskId = _createLongClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        vm.warp(block.timestamp + 8 weeks + 1);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // 10000 bps = 100%: 1000 DREAMS
        assertEq(hook.claimable(worker), 1000 * 1e18);
    }

    function test_creditWithSplit_zeroWhenRampIsZero() public {
        vm.prank(owner);
        hook.setRamp(
            [uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // Ramp at 0% for both parties — nothing credited
        assertEq(hook.claimable(worker), 0);
        assertEq(hook.claimable(requester), 0);
        assertEq(hook.totalClaimable(), 0);
        // Tokens were transferred from vault to hook — they sit as sweepable excess
        assertGt(dreamsToken.balanceOf(address(hook)), 0);
    }

    // ─── Worker/requester split ───────────────────────────────────────────────

    function test_requesterReceivesSplit() public {
        // Use 80/20 split; full-rate bypass ramp in setUp
        vm.prank(owner);
        hook.setWorkerSplitBps(8000);

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // 1000 DREAMS total: worker 80% = 800, requester 20% = 200
        assertEq(hook.claimable(worker), 800 * 1e18);
        assertEq(hook.claimable(requester), 200 * 1e18);
        assertEq(hook.totalClaimable(), 1000 * 1e18);
    }

    function test_workerSplitBps_configurable() public {
        vm.prank(owner);
        hook.setWorkerSplitBps(6000); // 60/40

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        // 1000 DREAMS total: worker 60% = 600, requester 40% = 400
        assertEq(hook.claimable(worker), 600 * 1e18);
        assertEq(hook.claimable(requester), 400 * 1e18);
    }

    function test_setWorkerSplitBps_revertsIfOver10000() public {
        vm.prank(owner);
        vm.expectRevert(TaskTokenRewardHook.InvalidBps.selector);
        hook.setWorkerSplitBps(10_001);
    }

    // ─── Ban ──────────────────────────────────────────────────────────────────

    function test_ban_skipsWorkerCredit() public {
        vm.prank(owner);
        hook.banWallet(worker);

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertEq(hook.claimable(worker), 0);
    }

    function test_ban_skipsRequesterCredit() public {
        vm.prank(owner);
        hook.setWorkerSplitBps(8000); // ensure requester would otherwise receive 20%
        vm.prank(owner);
        hook.banWallet(requester);

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertEq(hook.claimable(requester), 0);
        assertGt(hook.claimable(worker), 0); // worker still earns
    }

    function test_ban_doesNotZeroExistingClaimable() public {
        // Earn some rewards first, then ban — existing balance must remain withdrawable.
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 earned = hook.claimable(worker);
        assertGt(earned, 0);

        vm.prank(owner);
        hook.banWallet(worker);

        // Existing balance intact
        assertEq(hook.claimable(worker), earned);

        // Backend can still withdraw on the worker's behalf
        address dest = makeAddr("dest");
        vm.prank(backend);
        hook.withdrawFor(worker, dest);
        assertEq(dreamsToken.balanceOf(dest), earned);
    }

    // ─── setRamp validation ───────────────────────────────────────────────────

    function test_setRamp_revertsOnNonIncreasingThresholds() public {
        vm.prank(owner);
        vm.expectRevert(TaskTokenRewardHook.InvalidRamp.selector);
        hook.setRamp(
            [uint40(4 weeks), uint40(2 weeks), uint40(8 weeks)], [uint16(0), uint16(2500), uint16(5000), uint16(10_000)]
        );
    }

    // ─── sweepUnclaimed ───────────────────────────────────────────────────────

    function test_sweepUnclaimed_cannotSweepWorkerFunds() public {
        // Earn rewards so totalClaimable > 0; then try to sweep more than excess
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 balance = dreamsToken.balanceOf(address(hook));
        vm.prank(owner);
        vm.expectRevert(TaskTokenRewardHook.InsufficientSweepable.selector);
        hook.sweepUnclaimed(owner, balance); // would sweep into totalClaimable
    }

    function test_sweepUnclaimed_canSweepRampExcess() public {
        // Use 0% ramp so all tokens become sweepable excess
        vm.prank(owner);
        hook.setRamp([uint40(2 weeks), uint40(4 weeks), uint40(8 weeks)], [uint16(0), uint16(0), uint16(0), uint16(0)]);

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 excess = dreamsToken.balanceOf(address(hook));
        assertGt(excess, 0);
        assertEq(hook.totalClaimable(), 0);

        uint256 ownerBefore = dreamsToken.balanceOf(owner);
        vm.prank(owner);
        hook.sweepUnclaimed(owner, excess); // should succeed
        assertEq(dreamsToken.balanceOf(owner) - ownerBefore, excess);
    }

    // ─── Price drift clamping ─────────────────────────────────────────────────

    function test_priceDrift_clampedToFloor() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Price drops 50% — should be clamped to floor (startPrice * 0.8)
        oracle.setPrice(PRICE_DREAMS_USD / 2);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = hook.claimable(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        uint256 credited = hook.claimable(worker) - before;

        // At floor price (10e18 * 0.8 = 8e18): reward = 100e6 * 1e30 / 8e18 = 1250 DREAMS
        // (rather than 2000 DREAMS at the dropped price)
        assertLt(credited, 1300 * 1e18); // clamped
    }

    function test_priceDrift_clampedToCeiling() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Price rises 3x — should be clamped to ceiling (startPrice * 1.2)
        oracle.setPrice(PRICE_DREAMS_USD * 3);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = hook.claimable(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        uint256 credited = hook.claimable(worker) - before;

        // At ceiling price (10e18 * 1.2 = 12e18): reward = 100e6 * 1e30 / 12e18 ≈ 833 DREAMS
        assertLt(credited, 900 * 1e18);
        assertGt(credited, 800 * 1e18);
    }

    // ─── Oracle invalid ───────────────────────────────────────────────────────

    function test_oracleInvalid_blocksCheckFund() public {
        bytes memory data = abi.encodeCall(
            market.createTask,
            (
                REWARD_100_USDC,
                1 days,
                market.CLAIM(),
                0,
                0,
                bytes4(0),
                ITMPCore.HookConfig({ contracts: _hookArr(address(hook)), data: "" }),
                ITMPCore.TaskContent({ contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0) })
            )
        );
        oracle.setValid(false);
        vm.expectRevert();
        forwarder.relay(address(market), requester, REWARD_100_USDC, data);
    }

    function test_oracleInvalid_blocksCheckClaim() public {
        bytes32 taskId = _createClaimTask();
        oracle.setValid(false);
        vm.expectRevert();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
    }

    // Oracle invalid on a reserved (Claim) task: falls back to startPrice, settlement proceeds.
    function test_oracleInvalid_claimTask_fallsBackToStartPrice() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        oracle.setValid(false);
        // Should not revert — Path A falls back to startPrice so USDC payout proceeds.
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
    }

    // ─── Worker mismatch ─────────────────────────────────────────────────────

    function test_workerMismatch_revertsAtSubmit() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        address wrongWorker = makeAddr("wrongWorker");
        vm.expectRevert();
        _relay(wrongWorker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
    }

    // ─── Double payment blocked ───────────────────────────────────────────────

    function test_doublePayment_blocked() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        ITMPCore.Verdict memory verdict;
        ITMPCore.TaskContext memory ctx;
        ctx.requester = requester;
        vm.expectRevert(abi.encodeWithSelector(TaskTokenRewardHook.CallerNotDiamond.selector));
        hook.checkComplete(taskId, ctx, verdict);
    }

    // ─── Forfeit releases reserve ─────────────────────────────────────────────

    function test_forfeit_releasesReserve() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        vm.warp(block.timestamp + 2 days);
        _relay(requester, 0, abi.encodeCall(market.forfeitAndReopen, (taskId)));

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Cancel on unclaimed task: onCancel fires, no reserve to release ───────

    function test_cancel_noReserve_noRevert() public {
        bytes32 taskId = _createClaimTask();
        _relay(requester, 0, abi.encodeCall(market.cancelTask, (taskId, 0)));
        assertEq(vault.taskReserve(taskId), 0);
    }

    function test_expire_releasesReserve() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        vm.warp(block.timestamp + 2 days);
        market.refundExpired(taskId, 0);

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Epoch budget exceeded ────────────────────────────────────────────────

    function test_epochBudget_globalCapExceeded_claimSucceedsNoReservation() public {
        vm.prank(owner);
        budget.setGlobalCap(1); // 1 wei — too small for any reward

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Epoch rollover resets per-account usage ──────────────────────────────

    function test_epochRollover_resetsUsage() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("w"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("w"), 0)));

        assertGt(budget.workerUsed(worker), 0);

        vm.warp(block.timestamp + EPOCH_DURATION + 1);

        assertEq(budget.workerUsed(worker), 0);
        assertEq(budget.requesterUsed(requester), 0);
        assertEq(budget.globalUsed(), 0);
        assertEq(budget.remaining(requester, worker), MAX_PER_TASK);
    }

    // ─── Vault insufficient ───────────────────────────────────────────────────

    function test_vaultInsufficient_revertsAtClaim() public {
        uint256 avail = vault.available();
        vm.prank(owner);
        vault.withdraw(owner, avail);

        bytes32 taskId = _createClaimTask();
        vm.expectRevert();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
    }

    function test_vaultInsufficient_bounty_skipsBonusNotUSDP() public {
        bytes32 taskId = _createBountyTask();
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 avail = vault.available();
        vm.prank(owner);
        vault.withdraw(owner, avail);

        uint256 workerUsdcBefore = usdc.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        assertGt(usdc.balanceOf(worker), workerUsdcBefore);
    }

    // ─── EpochBudget branch coverage ─────────────────────────────────────────

    function test_epochBudget_taskCapExceeded_direct() public {
        vm.prank(address(hook));
        vm.expectRevert(abi.encodeWithSelector(EpochBudget.TaskCapExceeded.selector, MAX_PER_TASK + 1, MAX_PER_TASK));
        budget.checkAndConsume(requester, worker, MAX_PER_TASK + 1);
    }

    function test_epochBudget_workerCapExceeded_direct() public {
        vm.prank(owner);
        budget.setWorkerCap(100 * 1e18);
        vm.prank(address(hook));
        vm.expectRevert(abi.encodeWithSelector(EpochBudget.WorkerCapExceeded.selector, worker, 200 * 1e18, 100 * 1e18));
        budget.checkAndConsume(requester, worker, 200 * 1e18);
    }

    function test_epochBudget_requesterCapExceeded_direct() public {
        vm.prank(owner);
        budget.setRequesterCap(100 * 1e18);
        vm.prank(address(hook));
        vm.expectRevert(
            abi.encodeWithSelector(EpochBudget.RequesterCapExceeded.selector, requester, 200 * 1e18, 100 * 1e18)
        );
        budget.checkAndConsume(requester, worker, 200 * 1e18);
    }

    function test_epochBudget_release_noOp_whenAmountExceedsUsed() public {
        vm.prank(address(hook));
        budget.release(requester, worker, 999 * 1e18);
        assertEq(budget.workerUsed(worker), 0);
    }

    function test_epochBudget_setEpochDuration_zeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(EpochBudget.EpochDurationZero.selector);
        budget.setEpochDuration(0);
    }

    function test_epochBudget_setGlobalCap_overflowReverts() public {
        vm.prank(owner);
        vm.expectRevert(EpochBudget.CapExceedsUint192.selector);
        budget.setGlobalCap(uint256(type(uint192).max) + 1);
    }

    function test_epochBudget_setWorkerCap_overflowReverts() public {
        vm.prank(owner);
        vm.expectRevert(EpochBudget.CapExceedsUint192.selector);
        budget.setWorkerCap(uint256(type(uint192).max) + 1);
    }

    function test_epochBudget_setRequesterCap_overflowReverts() public {
        vm.prank(owner);
        vm.expectRevert(EpochBudget.CapExceedsUint192.selector);
        budget.setRequesterCap(uint256(type(uint192).max) + 1);
    }

    function test_onComplete_noOp_whenNotReserved() public {
        bytes32 taskId = _createBountyTask();
        vm.prank(address(market));
        ITMPCore.TaskContext memory ctx;
        ITMPCore.Verdict memory verdict;
        hook.onComplete(taskId, ctx, verdict);
        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── TaskTokenRewardHook Path B oracle-invalid branch ─────────────────────

    function test_bountyTask_oracleInvalid_atComplete_skipsToken() public {
        bytes32 taskId = _createBountyTask();
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        oracle.setValid(false);

        uint256 workerUsdcBefore = usdc.balanceOf(worker);
        uint256 workerClaimBefore = hook.claimable(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertGt(usdc.balanceOf(worker), workerUsdcBefore);
        assertEq(hook.claimable(worker), workerClaimBefore);
    }

    // ─── Additional branch-coverage tests ────────────────────────────────────

    function test_setDriftBandBps_tooHigh_reverts() public {
        vm.prank(owner);
        vm.expectRevert(TaskTokenRewardHook.DriftBandBpsTooHigh.selector);
        hook.setDriftBandBps(10_000);
    }

    function test_checkComplete_bounty_noWorkerFound() public {
        bytes32 taskId = _createBountyTask();

        vm.prank(address(market));
        ITMPCore.TaskContext memory ctx;
        ctx.requester = requester;
        ITMPCore.Verdict memory verdict;
        vm.expectRevert(abi.encodeWithSelector(TaskTokenRewardHook.NoWorkerFound.selector, taskId));
        hook.checkComplete(taskId, ctx, verdict);
    }

    function test_onComplete_defensive_releasesReserveWhenPaidMissed() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        vm.prank(address(market));
        ITMPCore.TaskContext memory ctx;
        ITMPCore.Verdict memory verdict;
        hook.onComplete(taskId, ctx, verdict);

        assertEq(vault.taskReserve(taskId), 0);
    }

    function test_onlyDiamond_nonDiamondCaller_reverts() public {
        ITMPCore.TaskContext memory ctx;
        ITMPCore.Verdict memory verdict;
        vm.expectRevert(TaskTokenRewardHook.CallerNotDiamond.selector);
        hook.checkComplete(bytes32(0), ctx, verdict);
    }
}
