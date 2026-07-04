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
    // expected token reward: rewardUsd * 10^(18+12) / price = 100e6 * 1e30 / 1e17 = 1000 DREAMS
    uint256 constant EXPECTED_REWARD_1000_DREAMS = 1000 * 1e18;

    uint256 constant EPOCH_DURATION = 7 days;
    uint256 constant GLOBAL_CAP = 1_000_000 * 1e18;
    uint256 constant WORKER_CAP = 100_000 * 1e18;
    uint256 constant REQUESTER_CAP = 500_000 * 1e18;
    uint256 constant MAX_PER_TASK = 10_000 * 1e18;
    uint16 constant DRIFT_BPS = 2000; // 20%

    ITMPDiamond market;
    MockPGTRForwarder forwarder;
    MockUSDC usdc;
    MockUSDC dreamsToken;

    MockOracle oracle;
    RewardVault vault;
    EpochBudget budget;
    TaskTokenRewardHook hook;

    address owner = makeAddr("owner");
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
            address(oracle), address(vault), address(budget), address(market), 18, DRIFT_BPS, owner
        );

        vault.setHook(address(hook));
        budget.setHook(address(hook));

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

        // Requester accepts — hook pays tokens. Price unchanged so effectivePrice = startPrice.
        uint256 workerDreamsBefore = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        uint256 workerDreamsAfter = dreamsToken.balanceOf(worker);
        // 100e6 * 1e30 / 1e17 = 1000 DREAMS
        assertEq(workerDreamsAfter - workerDreamsBefore, EXPECTED_REWARD_1000_DREAMS);
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

        uint256 workerDreamsBefore = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertGt(dreamsToken.balanceOf(worker), workerDreamsBefore);
    }

    // ─── Price drift clamping ─────────────────────────────────────────────────

    function test_priceDrift_clampedToFloor() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Price drops 50% — should be clamped to floor (startPrice * 0.8)
        oracle.setPrice(PRICE_DREAMS_USD / 2);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        uint256 paid = dreamsToken.balanceOf(worker) - before;

        // At floor price (10e18 * 0.8 = 8e18): reward = 100e6 * 1e30 / 8e18 = 1250 DREAMS
        // (rather than 2000 DREAMS at the dropped price)
        assertLt(paid, 1300 * 1e18); // clamped
    }

    function test_priceDrift_clampedToCeiling() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Price rises 3x — should be clamped to ceiling (startPrice * 1.2)
        oracle.setPrice(PRICE_DREAMS_USD * 3);

        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 before = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        uint256 paid = dreamsToken.balanceOf(worker) - before;

        // At ceiling price (10e18 * 1.2 = 12e18): reward = 100e6 * 1e30 / 12e18 ≈ 833 DREAMS
        assertLt(paid, 900 * 1e18);
        assertGt(paid, 800 * 1e18);
    }

    // ─── Oracle invalid ───────────────────────────────────────────────────────

    function test_oracleInvalid_blocksCheckFund() public {
        // Precompute mode + calldata so the expectRevert applies to the relay, not market.CLAIM()
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
        // The hook reverts with OracleInvalid inside checkFund, propagated through createTask
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

        // Direct call to checkComplete is blocked by onlyDiamond — CallerNotDiamond fires first,
        // which also prevents any double-payment path from being reached.
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

        // forfeitAndReopen is requester-called after expiry; releases via onForfeit
        vm.warp(block.timestamp + 2 days);
        _relay(requester, 0, abi.encodeCall(market.forfeitAndReopen, (taskId)));

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Cancel on unclaimed task: onCancel fires, no reserve to release ───────

    function test_cancel_noReserve_noRevert() public {
        bytes32 taskId = _createClaimTask();
        // Task is Open (unclaimed) — cancelTask fires onCancel with no reserve
        _relay(requester, 0, abi.encodeCall(market.cancelTask, (taskId, 0)));
        assertEq(vault.taskReserve(taskId), 0);
    }

    function test_expire_releasesReserve() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        // Fast-forward past expiry
        vm.warp(block.timestamp + 2 days);
        market.refundExpired(taskId, 0);

        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Epoch budget exceeded ────────────────────────────────────────────────

    function test_epochBudget_globalCapExceeded_claimSucceedsNoReservation() public {
        // Budget exhaustion is best-effort: claim succeeds but with zero token reservation.
        vm.prank(owner);
        budget.setGlobalCap(1); // 1 wei — too small for any reward

        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));

        // Task claimed successfully; token reserve is zero because checkAndConsume silently failed.
        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── Epoch rollover resets per-account usage ──────────────────────────────

    function test_epochRollover_resetsUsage() public {
        // Complete one task — consumes worker/requester/global budget
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("w"))));
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("w"), 0)));

        assertGt(budget.workerUsed(worker), 0);

        // Advance past the epoch boundary
        vm.warp(block.timestamp + EPOCH_DURATION + 1);

        // Usage should now read as zero in the new epoch
        assertEq(budget.workerUsed(worker), 0);
        assertEq(budget.requesterUsed(requester), 0);
        assertEq(budget.globalUsed(), 0);
        assertEq(budget.remaining(requester, worker), MAX_PER_TASK);
    }

    // ─── Vault insufficient ───────────────────────────────────────────────────

    function test_vaultInsufficient_revertsAtClaim() public {
        // Drain vault (compute available() before prank so it doesn't consume it)
        uint256 avail = vault.available();
        vm.prank(owner);
        vault.withdraw(owner, avail);

        bytes32 taskId = _createClaimTask();
        vm.expectRevert();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
    }

    // Vault empty on Bounty task: token bonus is skipped but USDC payout proceeds.
    function test_vaultInsufficient_bounty_skipsBonusNotUSDP() public {
        bytes32 taskId = _createBountyTask();
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));

        uint256 avail = vault.available();
        vm.prank(owner);
        vault.withdraw(owner, avail);

        uint256 workerUsdcBefore = usdc.balanceOf(worker);
        // Should not revert — token bonus is silently skipped when vault is empty.
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));
        // Worker still received USDC reward.
        assertGt(usdc.balanceOf(worker), workerUsdcBefore);
    }

    // ─── EpochBudget branch coverage ─────────────────────────────────────────

    // _reserveForWorker clips amount to remaining() before calling checkAndConsume, so
    // the cap-exceeded errors are only reachable by calling checkAndConsume directly.
    function test_epochBudget_taskCapExceeded_direct() public {
        vm.prank(address(hook));
        vm.expectRevert(abi.encodeWithSelector(EpochBudget.TaskCapExceeded.selector, MAX_PER_TASK + 1, MAX_PER_TASK));
        budget.checkAndConsume(requester, worker, MAX_PER_TASK + 1);
    }

    function test_epochBudget_workerCapExceeded_direct() public {
        vm.prank(owner);
        budget.setWorkerCap(100 * 1e18);
        // 200e18 > workerRem(100e18), below global/task caps → WorkerCapExceeded
        vm.prank(address(hook));
        vm.expectRevert(abi.encodeWithSelector(EpochBudget.WorkerCapExceeded.selector, worker, 200 * 1e18, 100 * 1e18));
        budget.checkAndConsume(requester, worker, 200 * 1e18);
    }

    function test_epochBudget_requesterCapExceeded_direct() public {
        vm.prank(owner);
        budget.setRequesterCap(100 * 1e18);
        // 200e18 > reqRem(100e18), below global/worker caps → RequesterCapExceeded
        vm.prank(address(hook));
        vm.expectRevert(
            abi.encodeWithSelector(EpochBudget.RequesterCapExceeded.selector, requester, 200 * 1e18, 100 * 1e18)
        );
        budget.checkAndConsume(requester, worker, 200 * 1e18);
    }

    function test_epochBudget_release_noOp_whenAmountExceedsUsed() public {
        // release when usage is 0 — all three if-branches take the false path (no-op)
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

    // onComplete false branch: state.reserved=false, nothing to release, no-op.
    function test_onComplete_noOp_whenNotReserved() public {
        bytes32 taskId = _createBountyTask();
        vm.prank(address(market));
        ITMPCore.TaskContext memory ctx;
        ITMPCore.Verdict memory verdict;
        hook.onComplete(taskId, ctx, verdict); // reserved=false → condition false, no-op
        assertEq(vault.taskReserve(taskId), 0);
    }

    // ─── TaskTokenRewardHook Path B oracle-invalid branch ─────────────────────

    // Oracle invalid at bounty complete: token bonus is skipped, USDC still paid.
    function test_bountyTask_oracleInvalid_atComplete_skipsToken() public {
        bytes32 taskId = _createBountyTask();
        _relay(worker, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("work"))));
        oracle.setValid(false);

        uint256 workerUsdcBefore = usdc.balanceOf(worker);
        uint256 workerDreamsBefore = dreamsToken.balanceOf(worker);
        _relay(requester, 0, abi.encodeCall(market.acceptSubmission, (taskId, worker, keccak256("work"), 0)));

        assertGt(usdc.balanceOf(worker), workerUsdcBefore);
        assertEq(dreamsToken.balanceOf(worker), workerDreamsBefore);
    }

    // ─── Constructor validation ───────────────────────────────────────────────

    function test_constructor_driftBandTooHigh_reverts() public {
        vm.expectRevert(TaskTokenRewardHook.DriftBandBpsTooHigh.selector);
        new TaskTokenRewardHook(address(oracle), address(vault), address(budget), address(market), 18, 10_000, owner);
    }

    function test_constructor_zeroOracle_reverts() public {
        vm.expectRevert(TaskTokenRewardHook.OracleInvalid.selector);
        new TaskTokenRewardHook(address(0), address(vault), address(budget), address(market), 18, DRIFT_BPS, owner);
    }

    function test_onlyDiamond_nonDiamondCaller_reverts() public {
        ITMPCore.TaskContext memory ctx;
        ITMPCore.Verdict memory verdict;
        vm.expectRevert(TaskTokenRewardHook.CallerNotDiamond.selector);
        hook.checkComplete(bytes32(0), ctx, verdict);
    }

    // ─── Additional branch-coverage tests ────────────────────────────────────

    function test_setDriftBandBps_tooHigh_reverts() public {
        vm.prank(owner);
        vm.expectRevert(TaskTokenRewardHook.DriftBandBpsTooHigh.selector);
        hook.setDriftBandBps(10_000);
    }

    // Calls checkComplete directly as the diamond on a bounty task where
    // task.worker == address(0) → exercises the Path B else branch and NoWorkerFound.
    function test_checkComplete_bounty_noWorkerFound() public {
        bytes32 taskId = _createBountyTask();
        // state.reserved=false (bounty); task.worker=address(0) (no submit/accept yet)

        vm.prank(address(market)); // msg.sender == diamond → passes onlyDiamond
        ITMPCore.TaskContext memory ctx;
        ctx.requester = requester;
        ITMPCore.Verdict memory verdict;
        vm.expectRevert(abi.encodeWithSelector(TaskTokenRewardHook.NoWorkerFound.selector, taskId));
        hook.checkComplete(taskId, ctx, verdict);
    }

    // Calls onComplete directly as the diamond while the task has reserved=true but
    // paid=false (simulates a missed checkComplete). The hook releases the reserve.
    function test_onComplete_defensive_releasesReserveWhenPaidMissed() public {
        bytes32 taskId = _createClaimTask();
        _relay(worker, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        // At this point: reserved=true, paid=false, reservedTokenAmount > 0

        uint256 reservedBefore = vault.taskReserve(taskId);
        assertGt(reservedBefore, 0);

        vm.prank(address(market)); // msg.sender == diamond → passes onlyDiamond
        ITMPCore.TaskContext memory ctx;
        ITMPCore.Verdict memory verdict;
        hook.onComplete(taskId, ctx, verdict);

        assertEq(vault.taskReserve(taskId), 0);
    }
}
