// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ITMPCore} from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";
import {ITMPDiamond} from "@taskmarket/contracts/src/interfaces/ITMPDiamond.sol";
import {ITMPHook} from "@taskmarket/contracts/src/interfaces/ITMPHook.sol";
import {MockERC20} from "@taskmarket/contracts/src/mocks/MockERC20.sol";
import {TaskMarketForwarder} from "@taskmarket/contracts/src/TaskMarketForwarder.sol";
import {DiamondTestHelper} from "@taskmarket/contracts/test/helpers/DiamondTestHelper.sol";
import {noEvaluatorConfig} from "@taskmarket/contracts/test/helpers/EvaluatorConfigHelper.sol";
import {taskConfig} from "@taskmarket/contracts/test/helpers/TaskConfigHelper.sol";
import {MockPGTRForwarder} from "@taskmarket/contracts/test/mocks/MockPGTRForwarder.sol";
import {AffiliateSidecarEscrowHook} from "../src/AffiliateSidecarEscrowHook.sol";

/// @dev Protocol-default hook that proves Taskmarket dispatches the same non-empty hookData to
///      default and requester hooks without consuming or rewriting the affiliate payload.
contract SharedHookDataProbe is ITMPHook {
    uint256 public checkFundCalls;
    uint256 public checkCompleteCalls;
    uint256 public onCompleteCalls;
    uint256 public lastHookDataLength;
    bytes32 public lastHookDataHash;

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(ITMPHook).interfaceId || interfaceId == 0x01ffc9a7;
    }

    function checkFund(bytes32, ITMPCore.TaskContext calldata, bytes calldata hookData) external returns (bool) {
        require(hookData.length != 0, "shared hookData missing");
        checkFundCalls++;
        lastHookDataLength = hookData.length;
        lastHookDataHash = keccak256(hookData);
        return true;
    }

    function checkClaim(bytes32, ITMPCore.TaskContext calldata, address) external pure returns (bool) {
        return true;
    }

    function checkSelectWorker(bytes32, ITMPCore.TaskContext calldata, address) external pure returns (bool) {
        return true;
    }

    function checkSubmit(bytes32, ITMPCore.TaskContext calldata, address, bytes32) external pure returns (bool) {
        return true;
    }

    function checkEvaluate(bytes32, ITMPCore.TaskContext calldata, address) external pure returns (bool) {
        return true;
    }

    function checkComplete(bytes32, ITMPCore.TaskContext calldata, ITMPCore.Verdict calldata) external returns (bool) {
        checkCompleteCalls++;
        return true;
    }

    function onComplete(bytes32, ITMPCore.TaskContext calldata, ITMPCore.Verdict calldata) external {
        onCompleteCalls++;
    }

    function onForfeit(bytes32, ITMPCore.TaskContext calldata, address) external pure {}

    function onCancel(bytes32, ITMPCore.TaskContext calldata) external pure {}

    function onExpire(bytes32, ITMPCore.TaskContext calldata) external pure {}
}

/// @notice End-to-end coverage against the commit-pinned Taskmarket Diamond implementation.
contract AffiliateSidecarEscrowHookLifecycleTest is DiamondTestHelper {
    uint256 private constant PAYER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant X = 90e6;
    uint256 private constant Y = 10e6;
    uint256 private constant DURATION = 1 days;
    uint8 private constant HOOK_DATA_VERSION = 1;
    bytes32 private constant AFFILIATE_ID = keccak256("builder-code");

    address private constant OWNER = address(1);
    address private constant FEE_RECIPIENT = address(2);
    address private constant REQUESTER = address(3);
    address private constant WORKER = address(4);
    address private constant AFFILIATE = address(5);
    address private constant WORKER_TWO = address(6);
    address private constant EVALUATOR = address(7);
    address private constant DISPUTE_RESOLVER = address(8);

    address private payer;
    ITMPDiamond private market;
    MockERC20 private usdc;
    MockPGTRForwarder private forwarder;
    AffiliateSidecarEscrowHook private hook;

    function setUp() public {
        payer = vm.addr(PAYER_PRIVATE_KEY);

        vm.startPrank(OWNER);
        usdc = new MockERC20("Mock USDC", "USDC", 6, OWNER);
        market = deployDiamond(OWNER, address(usdc), FEE_RECIPIENT, 500);
        forwarder = new MockPGTRForwarder(address(usdc));
        market.addForwarder(address(forwarder));
        usdc.mint(address(forwarder), 10_000e6);
        usdc.mint(payer, 10_000e6);
        vm.stopPrank();

        hook = new AffiliateSidecarEscrowHook(address(market));
        vm.prank(payer);
        usdc.approve(address(hook), type(uint256).max);
    }

    function testCreateTaskAtomicallyEscrowsIndependentXAndY() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 1);

        ITMPCore.Task memory task = market.getTask(taskId);
        AffiliateSidecarEscrowHook.Allocation memory allocation = _allocation(taskId);
        assertEq(task.reward, X, "Taskmarket escrows X");
        assertEq(allocation.taskAmount, X, "hook snapshots X");
        assertEq(allocation.affiliateAmount, Y, "hook independently escrows Y");
        assertEq(allocation.payer, payer);
        assertEq(allocation.requester, REQUESTER);
        assertEq(allocation.beneficiary, AFFILIATE);
        assertEq(allocation.refundRecipient, REQUESTER);
        assertEq(allocation.taskTermsHash, hook.currentTaskTermsHash(taskId));
        assertEq(uint8(allocation.status), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));
        assertEq(usdc.balanceOf(address(market)), X);
        assertEq(usdc.balanceOf(address(hook)), Y);
        assertEq(hook.totalLiability(address(usdc)), Y);
    }

    function testBountyCompletionPaysAffiliateExactlyY() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 1);
        bytes32 deliverable = keccak256("affiliate-hook-work");

        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmission, (taskId, WORKER, deliverable, 0)));

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));

        uint256 beforeBalance = usdc.balanceOf(AFFILIATE);
        vm.prank(address(0x9999));
        hook.claim(taskId);
        assertEq(usdc.balanceOf(AFFILIATE), beforeBalance + Y);
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Paid));
    }

    function testPitchSelectionAndAcceptancePaysAffiliateExactlyY() public {
        bytes32 taskId = _createTask(X, Y, market.PITCH(), bytes4(0), 2);
        bytes32 pitchHash = keccak256("affiliate-hook-pitch");
        bytes32 deliverable = keccak256("selected-pitch-work");

        _relay(WORKER, 0, abi.encodeCall(market.submitPitch, (taskId, pitchHash)));
        assertEq(market.taskPitchHashes(taskId, 0), pitchHash, "pitch reached the pinned Diamond");
        _relay(REQUESTER, 0, abi.encodeCall(market.selectWorker, (taskId, WORKER)));
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmission, (taskId, WORKER, deliverable, 0)));

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testBenchmarkProofAndAcceptancePaysAffiliateExactlyY() public {
        bytes32 taskId = _createTask(X, Y, market.BENCHMARK(), bytes4(0), 3);
        bytes32 proofHash = keccak256("affiliate-hook-benchmark-proof");

        _relay(WORKER, 0, abi.encodeCall(market.submitProof, (taskId, proofHash, keccak256("benchmark-v1"), 9_900)));
        assertEq(market.taskProofHashes(taskId, 0), proofHash, "proof reached the pinned Diamond");

        // Rev20 acceptance verifies submitWork's per-worker commitment. Anchor the same proof as
        // the deliverable before the requester accepts it.
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, proofHash)));
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmission, (taskId, WORKER, proofHash, 0)));

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testSplitAcceptancePaysAffiliateOnceForTheTaskNotPerWinner() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 4);
        bytes32 deliverableOne = keccak256("split-work-one");
        bytes32 deliverableTwo = keccak256("split-work-two");
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverableOne)));
        _relay(WORKER_TWO, 0, abi.encodeCall(market.submitWork, (taskId, deliverableTwo)));

        address[] memory workers = new address[](2);
        workers[0] = WORKER;
        workers[1] = WORKER_TWO;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 6_000;
        shares[1] = 4_000;
        bytes32[] memory deliverables = new bytes32[](2);
        deliverables[0] = deliverableOne;
        deliverables[1] = deliverableTwo;

        uint256 workerOneBefore = usdc.balanceOf(WORKER);
        uint256 workerTwoBefore = usdc.balanceOf(WORKER_TWO);
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmissions, (taskId, workers, shares, deliverables, 0)));

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertGt(usdc.balanceOf(WORKER), workerOneBefore, "first winner received its split");
        assertGt(usdc.balanceOf(WORKER_TWO), workerTwoBefore, "second winner received its split");

        uint256 affiliateBefore = usdc.balanceOf(AFFILIATE);
        hook.claim(taskId);
        assertEq(usdc.balanceOf(AFFILIATE), affiliateBefore + Y, "one task releases one Y");
        assertEq(hook.totalLiability(address(usdc)), 0, "the one allocation is fully settled");

        vm.expectRevert(
            abi.encodeWithSelector(
                AffiliateSidecarEscrowHook.AllocationNotClaimable.selector,
                taskId,
                AffiliateSidecarEscrowHook.AllocationStatus.Paid
            )
        );
        hook.claim(taskId);
        assertEq(usdc.balanceOf(AFFILIATE), affiliateBefore + Y, "multiple winners cannot multiply Y");
    }

    function testCancellationRefundsYToSignedRecipient() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 1);
        _relay(REQUESTER, 0, abi.encodeCall(market.cancelTask, (taskId, 0)));

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Cancelled));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.RefundClaimable));

        uint256 afterCoreRefund = usdc.balanceOf(REQUESTER);
        hook.claim(taskId);
        assertEq(usdc.balanceOf(REQUESTER), afterCoreRefund + Y);
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Refunded));
    }

    function testNormalExpiryRefundsYToSignedRecipient() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 1);
        vm.warp(market.getTask(taskId).expiryTime + 1);
        market.refundExpired(taskId, 0);

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Expired));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.RefundClaimable));

        uint256 afterCoreRefund = usdc.balanceOf(REQUESTER);
        hook.claim(taskId);
        assertEq(usdc.balanceOf(REQUESTER), afterCoreRefund + Y);
    }

    function testForfeitAndReopenKeepsYEscrowed() public {
        bytes32 taskId = _createTask(X, Y, market.CLAIM(), bytes4(0), 1);
        _relay(WORKER, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        vm.warp(market.getTask(taskId).expiryTime + 1);
        _relay(REQUESTER, 0, abi.encodeCall(market.forfeitAndReopen, (taskId)));

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Open));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));
        assertEq(usdc.balanceOf(address(hook)), Y);
        assertEq(hook.totalLiability(address(usdc)), Y);
    }

    function testDutchAuctionExpiryAutoCompletionPaysAffiliateExactlyY() public {
        bytes32 taskId = _createTask(X, Y, market.AUCTION(), market.AUCTION_DUTCH(), 1);
        uint256 acceptedPrice = 40e6;
        bytes32 deliverable = keccak256("auction-work");

        _relay(WORKER, 0, abi.encodeCall(market.acceptAuction, (taskId, acceptedPrice)));
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        vm.warp(market.getTask(taskId).expiryTime + 1);
        market.refundExpired(taskId, 0);

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testReverseDutchAuctionExpiryAutoCompletionPaysAffiliateExactlyY() public {
        bytes32 taskId = _createTask(X, Y, market.AUCTION(), market.AUCTION_REVERSE_DUTCH(), 2);
        uint256 acceptedPrice = 55e6;
        bytes32 deliverable = keccak256("reverse-dutch-work");

        _relay(WORKER, 0, abi.encodeCall(market.acceptAuction, (taskId, acceptedPrice)));
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        vm.warp(market.getTask(taskId).expiryTime + 1);
        market.refundExpired(taskId, 0);

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertEq(market.getTask(taskId).stakeAmount, acceptedPrice, "reverse clock price settles X");
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testEnglishAuctionWinningBidAcceptancePaysAffiliateExactlyY() public {
        bytes32 taskId = _completeBidAuction(market.AUCTION_ENGLISH(), 3);
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testReverseEnglishAuctionWinningBidAcceptancePaysAffiliateExactlyY() public {
        bytes32 taskId = _completeBidAuction(market.AUCTION_REVERSE_ENGLISH(), 4);
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testEvaluatorApprovalFinalizePaysAffiliateAfterAppealWindow() public {
        ITMPCore.TaskEvaluatorConfig memory evaluatorConfig = _evaluatorConfig(address(0));
        bytes32 taskId = _createTaskWithEvaluator(X, Y, market.CLAIM(), bytes4(0), 5, evaluatorConfig);
        bytes32 deliverable = keccak256("evaluator-approved-work");
        _relay(WORKER, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Review));

        ITMPCore.Award[] memory awards = _singleAward(X);
        _relay(
            EVALUATOR,
            0,
            abi.encodeCall(
                market.evaluate, (taskId, ITMPCore.VerdictType.APPROVE, 9_500, 10_000, keccak256("approved"), awards)
            )
        );
        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Appealing));
        assertEq(
            uint8(_status(taskId)),
            uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed),
            "an appealable verdict is not terminal"
        );

        vm.warp(block.timestamp + evaluatorConfig.appealWindow + 1);
        market.finalizeVerdict(taskId);

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testEvaluatorRejectionFinalizeRefundsAffiliateEscrow() public {
        ITMPCore.TaskEvaluatorConfig memory evaluatorConfig = _evaluatorConfig(address(0));
        bytes32 taskId = _createTaskWithEvaluator(X, Y, market.CLAIM(), bytes4(0), 6, evaluatorConfig);
        _relay(WORKER, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("rejected-work"))));

        ITMPCore.Award[] memory noAwards = new ITMPCore.Award[](0);
        _relay(
            EVALUATOR,
            0,
            abi.encodeCall(
                market.evaluate, (taskId, ITMPCore.VerdictType.REJECT, 0, 10_000, keccak256("rejected"), noAwards)
            )
        );
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));

        vm.warp(block.timestamp + evaluatorConfig.appealWindow + 1);
        market.finalizeVerdict(taskId);

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Cancelled));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.RefundClaimable));
        uint256 requesterAfterCoreRefund = usdc.balanceOf(REQUESTER);
        uint256 affiliateBefore = usdc.balanceOf(AFFILIATE);
        hook.claim(taskId);
        assertEq(usdc.balanceOf(REQUESTER), requesterAfterCoreRefund + Y, "rejected task refunds Y");
        assertEq(usdc.balanceOf(AFFILIATE), affiliateBefore, "rejection never pays the affiliate");
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Refunded));
    }

    function testEvaluatorDisputePartialResolutionStillPaysFullFixedY() public {
        ITMPCore.TaskEvaluatorConfig memory evaluatorConfig = _evaluatorConfig(DISPUTE_RESOLVER);
        bytes32 taskId = _createTaskWithEvaluator(X, Y, market.CLAIM(), bytes4(0), 7, evaluatorConfig);
        _relay(WORKER, 0, abi.encodeCall(market.claimTask, (taskId, 0)));
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, keccak256("appealed-work"))));

        ITMPCore.Award[] memory fullAward = _singleAward(X);
        _relay(
            EVALUATOR,
            0,
            abi.encodeCall(
                market.evaluate,
                (taskId, ITMPCore.VerdictType.APPROVE, 9_000, 10_000, keccak256("initial-verdict"), fullAward)
            )
        );
        _relay(WORKER, 0, abi.encodeCall(market.appeal, (taskId)));
        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Disputed));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));

        ITMPCore.Award[] memory partialAward = _singleAward(X / 2);
        vm.prank(DISPUTE_RESOLVER);
        market.resolveDispute(taskId, ITMPCore.VerdictType.PARTIAL, partialAward);

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertEq(
            uint8(market.getTaskVerdict(taskId).verdictType),
            uint8(ITMPCore.VerdictType.PARTIAL),
            "resolver replaced the appealed verdict"
        );
        _claimAffiliateAndAssertExactY(taskId);
    }

    function testReconcileRecoversSwallowedCompletionCallback() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 1);
        bytes32 deliverable = keccak256("missed-callback-work");
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));

        vm.mockCallRevert(
            address(hook), ITMPHook.onComplete.selector, abi.encodeWithSignature("Error(string)", "missed callback")
        );
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmission, (taskId, WORKER, deliverable, 0)));
        vm.clearMockedCalls();

        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));

        hook.reconcile(taskId);
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));
        hook.claim(taskId);
        assertEq(usdc.balanceOf(AFFILIATE), Y);
    }

    function testTaskRewardUpdateLeavesSnapshottedYUnchanged() public {
        bytes32 taskId = _createTask(X, Y, market.BOUNTY(), bytes4(0), 1);
        uint256 updatedX = X + 20e6;

        _relay(REQUESTER, updatedX - X, abi.encodeCall(market.updateTask, (taskId, updatedX, 0, 0, 0)));

        AffiliateSidecarEscrowHook.Allocation memory allocation = _allocation(taskId);
        assertEq(market.getTask(taskId).reward, updatedX);
        assertEq(allocation.taskAmount, X, "creation-time X remains an audit snapshot");
        assertEq(allocation.affiliateAmount, Y, "Y is independent from later X updates");
        assertEq(hook.totalLiability(address(usdc)), Y);
    }

    function testYPullFailureRevertsWholeTaskCreation() public {
        vm.prank(payer);
        usdc.approve(address(hook), 0);
        (bytes32 taskId, bytes memory createCall) = _prepareCreate(X, Y, market.BOUNTY(), bytes4(0), 1);

        uint256 diamondBefore = usdc.balanceOf(address(market));
        uint256 forwarderBefore = usdc.balanceOf(address(forwarder));
        vm.expectRevert(ITMPCore.HookCheckFundRejected.selector);
        forwarder.relay(address(market), REQUESTER, X, createCall);

        assertEq(usdc.balanceOf(address(market)), diamondBefore, "X transfer reverted");
        assertEq(usdc.balanceOf(address(forwarder)), forwarderBefore, "forwarder recovered X");
        assertEq(market.getTask(taskId).id, bytes32(0), "task state reverted");
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.None));
        assertFalse(hook.usedNonces(payer, 1));
    }

    function testProductionForwarderSinglePayerFundsXAndYAtomically() public {
        TaskMarketForwarder productionForwarder = new TaskMarketForwarder(address(usdc), address(market), payer);
        vm.prank(OWNER);
        market.addForwarder(address(productionForwarder));

        vm.startPrank(payer);
        usdc.approve(address(productionForwarder), X);
        usdc.approve(address(hook), 0);
        vm.stopPrank();

        (bytes32 taskId, bytes memory createCall) = _prepareCreate(X, Y, market.BOUNTY(), bytes4(0), 77);
        uint256 payerBefore = usdc.balanceOf(payer);
        uint256 marketBefore = usdc.balanceOf(address(market));
        uint256 hookBefore = usdc.balanceOf(address(hook));
        uint256 validBefore = block.timestamp + 5 minutes;
        bytes32 receiptNonce = keccak256("affiliate-production-topology");

        vm.prank(payer);
        vm.expectRevert(ITMPCore.HookCheckFundRejected.selector);
        productionForwarder.relay(REQUESTER, X, validBefore, receiptNonce, createCall);

        assertEq(usdc.balanceOf(payer), payerBefore, "failed Y pull rolls back payer's X");
        assertEq(usdc.balanceOf(address(market)), marketBefore, "failed Y pull rolls back market X");
        assertEq(usdc.balanceOf(address(hook)), hookBefore, "failed Y pull leaves no sidecar escrow");
        assertEq(market.getTask(taskId).id, bytes32(0), "failed Y pull rolls back task creation");
        assertFalse(hook.usedNonces(payer, 77), "failed Y pull rolls back authorization nonce");

        vm.prank(payer);
        usdc.approve(address(hook), Y);
        vm.prank(payer);
        productionForwarder.relay(REQUESTER, X, validBefore, receiptNonce, createCall);

        AffiliateSidecarEscrowHook.Allocation memory allocation = _allocation(taskId);
        assertEq(usdc.balanceOf(payer), payerBefore - X - Y, "one payer funds both escrows");
        assertEq(usdc.balanceOf(address(market)), marketBefore + X, "forwarder sends X to Taskmarket");
        assertEq(usdc.balanceOf(address(hook)), hookBefore + Y, "hook pulls Y from the same payer");
        assertEq(market.getTask(taskId).reward, X);
        assertEq(allocation.payer, payer);
        assertEq(allocation.taskAmount, X);
        assertEq(allocation.affiliateAmount, Y);
        assertEq(allocation.taskTermsHash, hook.currentTaskTermsHash(taskId));
        assertEq(uint8(allocation.status), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));
    }

    function testProtocolDefaultHookSharesDataAndPreservesAtomicXPlusYFunding() public {
        SharedHookDataProbe defaultHook = new SharedHookDataProbe();
        address[] memory defaultHooks = new address[](1);
        defaultHooks[0] = address(defaultHook);
        vm.prank(OWNER);
        market.setDefaultHooks(defaultHooks);

        vm.prank(payer);
        usdc.approve(address(hook), 0);
        (bytes32 taskId, bytes memory createCall) = _prepareCreate(X, Y, market.BOUNTY(), bytes4(0), 8);
        uint256 marketBefore = usdc.balanceOf(address(market));
        uint256 forwarderBefore = usdc.balanceOf(address(forwarder));

        vm.expectRevert(ITMPCore.HookCheckFundRejected.selector);
        forwarder.relay(address(market), REQUESTER, X, createCall);

        assertEq(usdc.balanceOf(address(market)), marketBefore, "failed Y rolls back the X escrow");
        assertEq(usdc.balanceOf(address(forwarder)), forwarderBefore, "failed Y returns X to its funder");
        assertEq(defaultHook.checkFundCalls(), 0, "earlier default-hook effects roll back too");
        assertEq(market.getTask(taskId).id, bytes32(0), "no partially funded task remains");
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.None));
        assertFalse(hook.usedNonces(payer, 8));

        vm.prank(payer);
        usdc.approve(address(hook), Y);
        bytes32 created = abi.decode(forwarder.relay(address(market), REQUESTER, X, createCall), (bytes32));
        assertEq(created, taskId);

        address[] memory resolvedHooks = market.getTaskHooks(taskId);
        assertEq(resolvedHooks.length, 2, "default and affiliate hook coexist");
        assertEq(resolvedHooks[0], address(defaultHook), "protocol default dispatches first");
        assertEq(resolvedHooks[1], address(hook), "affiliate remains the requester hook");
        assertEq(defaultHook.checkFundCalls(), 1);
        assertGt(defaultHook.lastHookDataLength(), 0, "default hook received shared affiliate hookData");
        assertNotEq(defaultHook.lastHookDataHash(), keccak256(bytes("")), "shared payload is non-empty");
        assertEq(usdc.balanceOf(address(market)), marketBefore + X, "X is fully escrowed");
        assertEq(usdc.balanceOf(address(hook)), Y, "Y is fully escrowed");

        bytes32 deliverable = keccak256("default-hook-coexistence-work");
        _relay(WORKER, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmission, (taskId, WORKER, deliverable, 0)));
        assertEq(defaultHook.checkCompleteCalls(), 1, "default hook participates in completion checks");
        assertEq(defaultHook.onCompleteCalls(), 1, "default hook receives completion callback");
        _claimAffiliateAndAssertExactY(taskId);
    }

    function _createTask(uint256 taskAmount, uint256 affiliateAmount, bytes4 mode, bytes4 auctionSubtype, uint256 nonce)
        private
        returns (bytes32 taskId)
    {
        bytes memory createCall;
        (taskId, createCall) = _prepareCreate(taskAmount, affiliateAmount, mode, auctionSubtype, nonce);
        bytes32 created = abi.decode(forwarder.relay(address(market), REQUESTER, taskAmount, createCall), (bytes32));
        assertEq(created, taskId, "precomputed task id");
    }

    function _createTaskWithEvaluator(
        uint256 taskAmount,
        uint256 affiliateAmount,
        bytes4 mode,
        bytes4 auctionSubtype,
        uint256 nonce,
        ITMPCore.TaskEvaluatorConfig memory evaluatorConfig
    ) private returns (bytes32 taskId) {
        bytes memory createCall;
        (taskId, createCall) =
            _prepareCreateWithEvaluator(taskAmount, affiliateAmount, mode, auctionSubtype, nonce, evaluatorConfig);
        bytes32 created = abi.decode(forwarder.relay(address(market), REQUESTER, taskAmount, createCall), (bytes32));
        assertEq(created, taskId, "precomputed evaluator task id");
    }

    function _prepareCreate(
        uint256 taskAmount,
        uint256 affiliateAmount,
        bytes4 mode,
        bytes4 auctionSubtype,
        uint256 nonce
    ) private view returns (bytes32 taskId, bytes memory createCall) {
        return _prepareCreateWithEvaluator(
            taskAmount, affiliateAmount, mode, auctionSubtype, nonce, noEvaluatorConfig()
        );
    }

    function _prepareCreateWithEvaluator(
        uint256 taskAmount,
        uint256 affiliateAmount,
        bytes4 mode,
        bytes4 auctionSubtype,
        uint256 nonce,
        ITMPCore.TaskEvaluatorConfig memory evaluatorConfig
    ) private view returns (bytes32 taskId, bytes memory createCall) {
        taskId = keccak256(abi.encode(block.chainid, address(market), REQUESTER, market.requesterNonce(REQUESTER)));
        address[] memory hooks = new address[](1);
        hooks[0] = address(hook);
        ITMPCore.TaskConfig memory config;
        if (mode == market.AUCTION()) {
            config = taskConfig(taskAmount, DURATION, mode, 0, 12 hours, auctionSubtype);
        } else if (mode == market.PITCH()) {
            config = taskConfig(taskAmount, DURATION, mode, 12 hours, 0, bytes4(0));
        } else {
            config = taskConfig(taskAmount, DURATION, mode);
        }
        ITMPCore.StakeConfig memory stakeConfig = ITMPCore.StakeConfig({required: false, bps: 0});
        ITMPCore.TaskContent memory content =
            ITMPCore.TaskContent({contentHash: bytes32(0), contentURI: "", tags: new bytes32[](0)});
        bytes32 termsHash = _taskTermsHash(config, stakeConfig, hooks, content, evaluatorConfig);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization =
            AffiliateSidecarEscrowHook.FundingAuthorization({
                taskTermsHash: termsHash,
                payer: payer,
                beneficiary: AFFILIATE,
                refundRecipient: REQUESTER,
                affiliateId: AFFILIATE_ID,
                affiliateAmount: affiliateAmount,
                nonce: nonce,
                deadline: block.timestamp + 1 days
            });
        bytes32 digest = hook.fundingDigest(taskId, REQUESTER, address(usdc), taskAmount, authorization);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_PRIVATE_KEY, digest);
        bytes memory hookData = abi.encode(HOOK_DATA_VERSION, authorization, abi.encodePacked(r, s, v));
        createCall = abi.encodeCall(
            market.createTask,
            (config, stakeConfig, ITMPCore.HookConfig({contracts: hooks, data: hookData}), content, evaluatorConfig)
        );
    }

    function _completeBidAuction(bytes4 auctionSubtype, uint256 nonce) private returns (bytes32 taskId) {
        taskId = _createTask(X, Y, market.AUCTION(), auctionSubtype, nonce);
        uint256 firstPrice = 70e6;
        uint256 winningPrice = 45e6;
        _relay(WORKER, 0, abi.encodeCall(market.submitBid, (taskId, firstPrice)));
        _relay(WORKER_TWO, 0, abi.encodeCall(market.submitBid, (taskId, winningPrice)));

        vm.warp(market.getTaskAuctionConfig(taskId).bidDeadline);
        _relay(REQUESTER, 0, abi.encodeCall(market.selectLowestBidder, (taskId)));
        ITMPCore.Task memory selected = market.getTask(taskId);
        assertEq(uint8(selected.status), uint8(ITMPCore.TaskStatus.Claimed));
        assertEq(selected.worker, WORKER_TWO, "rev20 selects the running lowest bidder");
        assertEq(selected.stakeAmount, winningPrice, "winning bid fixes the auction payout");

        bytes32 deliverable = keccak256(abi.encode("bid-auction-work", auctionSubtype));
        _relay(WORKER_TWO, 0, abi.encodeCall(market.submitWork, (taskId, deliverable)));
        _relay(REQUESTER, 0, abi.encodeCall(market.acceptSubmission, (taskId, WORKER_TWO, deliverable, 0)));
        assertEq(uint8(market.getTaskState(taskId)), uint8(ITMPCore.TaskStatus.Accepted));
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));
    }

    function _evaluatorConfig(address disputeResolver) private pure returns (ITMPCore.TaskEvaluatorConfig memory) {
        return ITMPCore.TaskEvaluatorConfig({
            evaluator: EVALUATOR,
            evaluatorStake: 0,
            evaluatorFeeBps: 0,
            evaluationWindow: uint32(2 days),
            appealWindow: uint32(1 days),
            disputeResolver: disputeResolver
        });
    }

    function _singleAward(uint256 amount) private pure returns (ITMPCore.Award[] memory awards) {
        awards = new ITMPCore.Award[](1);
        awards[0] = ITMPCore.Award({worker: WORKER, amount: amount, rank: 1});
    }

    function _claimAffiliateAndAssertExactY(bytes32 taskId) private {
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));
        uint256 affiliateBefore = usdc.balanceOf(AFFILIATE);
        hook.claim(taskId);
        assertEq(usdc.balanceOf(AFFILIATE), affiliateBefore + Y, "terminal success pays exactly Y");
        assertEq(uint8(_status(taskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Paid));
    }

    function _taskTermsHash(
        ITMPCore.TaskConfig memory config,
        ITMPCore.StakeConfig memory stakeConfig,
        address[] memory customHooks,
        ITMPCore.TaskContent memory content,
        ITMPCore.TaskEvaluatorConfig memory evaluatorConfig
    ) private view returns (bytes32) {
        address[] memory defaultHooks = market.getDefaultHooks();
        address[] memory orderedHooks = new address[](defaultHooks.length + customHooks.length);
        for (uint256 i; i < defaultHooks.length; i++) {
            orderedHooks[i] = defaultHooks[i];
        }
        for (uint256 i; i < customHooks.length; i++) {
            orderedHooks[defaultHooks.length + i] = customHooks[i];
        }

        return hook.taskTermsHash(
            AffiliateSidecarEscrowHook.TaskTerms({
                duration: config.duration,
                mode: config.mode,
                pitchDuration: config.pitchDeadline,
                bidDuration: config.bidDeadline,
                auctionSubtype: config.auctionSubtype,
                stakeRequired: stakeConfig.required,
                stakeBps: stakeConfig.bps,
                feeBps: market.defaultFeeBps(),
                evaluator: evaluatorConfig.evaluator,
                evaluatorStake: evaluatorConfig.evaluatorStake,
                evaluatorFeeBps: evaluatorConfig.evaluatorFeeBps,
                evaluationWindow: evaluatorConfig.evaluationWindow,
                appealWindow: evaluatorConfig.appealWindow,
                disputeResolver: evaluatorConfig.disputeResolver,
                contentHash: content.contentHash,
                contentURIHash: keccak256(bytes(content.contentURI)),
                tagsHash: keccak256(abi.encode(content.tags)),
                hooksHash: keccak256(abi.encode(orderedHooks))
            })
        );
    }

    function _relay(address actor, uint256 paymentAmount, bytes memory data) private returns (bytes memory) {
        return forwarder.relay(address(market), actor, paymentAmount, data);
    }

    function _allocation(bytes32 taskId)
        private
        view
        returns (AffiliateSidecarEscrowHook.Allocation memory allocation)
    {
        (
            allocation.payer,
            allocation.requester,
            allocation.beneficiary,
            allocation.refundRecipient,
            allocation.paymentToken,
            allocation.affiliateId,
            allocation.taskTermsHash,
            allocation.taskAmount,
            allocation.affiliateAmount,
            allocation.status
        ) = hook.allocations(taskId);
    }

    function _status(bytes32 taskId) private view returns (AffiliateSidecarEscrowHook.AllocationStatus) {
        return _allocation(taskId).status;
    }
}
