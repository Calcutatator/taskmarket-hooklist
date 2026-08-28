// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1271WalletMock} from "@openzeppelin/contracts/mocks/ERC1271WalletMock.sol";
import {ITMPCore} from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";
import {ITMPHook} from "@taskmarket/contracts/src/interfaces/ITMPHook.sol";
import {MockERC20} from "@taskmarket/contracts/src/mocks/MockERC20.sol";
import {BaseTMPHook} from "@taskmarket/contracts/src/hooks/base/BaseTMPHook.sol";
import {AffiliateSidecarEscrowHook} from "../src/AffiliateSidecarEscrowHook.sol";

contract MockTaskmarketForAffiliateHook {
    mapping(bytes32 taskId => ITMPCore.Task task) private _tasks;
    mapping(bytes32 taskId => ITMPCore.TaskMetadata metadata) private _metadata;
    mapping(bytes32 taskId => ITMPCore.TaskEvaluatorConfig evaluator) private _evaluators;
    mapping(bytes32 taskId => ITMPCore.TaskAuctionConfig auction) private _auctions;
    mapping(bytes32 taskId => ITMPCore.TaskPitchConfig pitch) private _pitches;
    mapping(bytes32 taskId => address[] hooks) private _hooks;
    mapping(bytes32 taskId => bytes32[] tags) private _tags;
    mapping(bytes32 taskId => address paymentToken) private _paymentTokens;

    function setTask(ITMPCore.Task calldata task) external {
        _tasks[task.id] = task;
    }

    function setTaskMetadata(bytes32 taskId, ITMPCore.TaskMetadata calldata metadata) external {
        _metadata[taskId] = metadata;
    }

    function setTaskEvaluatorConfig(bytes32 taskId, ITMPCore.TaskEvaluatorConfig calldata evaluator) external {
        _evaluators[taskId] = evaluator;
    }

    function setTaskAuctionConfig(bytes32 taskId, ITMPCore.TaskAuctionConfig calldata auction) external {
        _auctions[taskId] = auction;
    }

    function setTaskPitchConfig(bytes32 taskId, ITMPCore.TaskPitchConfig calldata pitch) external {
        _pitches[taskId] = pitch;
    }

    function setTaskHooks(bytes32 taskId, address[] calldata hooks) external {
        _hooks[taskId] = hooks;
    }

    function setTaskTags(bytes32 taskId, bytes32[] calldata tags) external {
        _tags[taskId] = tags;
    }

    function setTaskPaymentToken(bytes32 taskId, address paymentToken) external {
        _paymentTokens[taskId] = paymentToken;
    }

    function setTaskContentHash(bytes32 taskId, bytes32 contentHash) external {
        _metadata[taskId].contentHash = contentHash;
    }

    function setTaskStatus(bytes32 taskId, ITMPCore.TaskStatus status) external {
        _tasks[taskId].status = status;
    }

    function getTask(bytes32 taskId) external view returns (ITMPCore.Task memory) {
        return _tasks[taskId];
    }

    function getTaskContext(bytes32 taskId) external view returns (ITMPCore.TaskContext memory ctx) {
        ITMPCore.Task storage task = _tasks[taskId];
        ITMPCore.TaskEvaluatorConfig storage evaluator = _evaluators[taskId];
        ctx.taskId = taskId;
        ctx.requester = task.requester;
        ctx.evaluator = evaluator.evaluator;
        ctx.paymentToken = _paymentTokens[taskId];
        ctx.reward = task.reward;
        ctx.evaluatorStake = evaluator.evaluatorStake;
        ctx.evaluatorFeeBps = evaluator.evaluatorFeeBps;
        ctx.submissionDeadline = task.expiryTime;
        ctx.evaluationWindow = evaluator.evaluationWindow;
        ctx.appealWindow = evaluator.appealWindow;
        ctx.disputeResolver = evaluator.disputeResolver;
        ctx.currentState = task.status;
        ctx.mode = task.mode;
        ctx.tags = _tags[taskId];
    }

    function getTaskMetadata(bytes32 taskId) external view returns (ITMPCore.TaskMetadata memory) {
        return _metadata[taskId];
    }

    function getTaskEvaluatorConfig(bytes32 taskId) external view returns (ITMPCore.TaskEvaluatorConfig memory) {
        return _evaluators[taskId];
    }

    function getTaskAuctionConfig(bytes32 taskId) external view returns (ITMPCore.TaskAuctionConfig memory) {
        return _auctions[taskId];
    }

    function getTaskPitchConfig(bytes32 taskId) external view returns (ITMPCore.TaskPitchConfig memory) {
        return _pitches[taskId];
    }

    function getTaskHooks(bytes32 taskId) external view returns (address[] memory) {
        return _hooks[taskId];
    }

    function checkFund(ITMPHook hook, bytes32 taskId, ITMPCore.TaskContext calldata ctx, bytes calldata hookData)
        external
        returns (bool)
    {
        return hook.checkFund(taskId, ctx, hookData);
    }

    function onComplete(
        ITMPHook hook,
        bytes32 taskId,
        ITMPCore.TaskContext calldata ctx,
        ITMPCore.Verdict calldata verdict
    ) external {
        hook.onComplete(taskId, ctx, verdict);
    }

    function onCancel(ITMPHook hook, bytes32 taskId, ITMPCore.TaskContext calldata ctx) external {
        hook.onCancel(taskId, ctx);
    }

    function onExpire(ITMPHook hook, bytes32 taskId, ITMPCore.TaskContext calldata ctx) external {
        hook.onExpire(taskId, ctx);
    }

    function onForfeit(ITMPHook hook, bytes32 taskId, ITMPCore.TaskContext calldata ctx, address worker) external {
        hook.onForfeit(taskId, ctx, worker);
    }
}

contract AffiliateSidecarEscrowHookTest is Test {
    uint256 private constant PAYER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant ERC1271_OWNER_PRIVATE_KEY = 0xC0FFEE;
    uint256 private constant WRONG_PRIVATE_KEY = 0xB0B;
    bytes32 private constant TASK_ID = keccak256("affiliate-sidecar-task");
    bytes32 private constant AFFILIATE_ID = keccak256("builder-code");
    bytes32 private constant CONTENT_HASH = keccak256("affiliate-sidecar-content");
    bytes32 private constant TAG_ONE = keccak256("solidity");
    bytes32 private constant TAG_TWO = keccak256("affiliate");
    bytes4 private constant MODE = bytes4(keccak256("BOUNTY"));
    uint8 private constant HOOK_DATA_VERSION = 1;
    uint16 private constant FEE_BPS = 500;
    uint256 private constant DURATION = 3 days;
    uint256 private constant TASK_AMOUNT = 90e6;
    uint256 private constant AFFILIATE_AMOUNT = 10e6;
    string private constant CONTENT_URI = "ipfs://affiliate-sidecar-content";

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EIP712_NAME_HASH = keccak256("AffiliateSidecarEscrowHook");
    bytes32 private constant EIP712_VERSION_HASH = keccak256("1");
    bytes32 private constant FUNDING_AUTHORIZATION_TYPEHASH = keccak256(
        "AffiliateFunding(bytes32 taskId,address requester,address paymentToken,uint256 taskAmount,bytes32 taskTermsHash,address payer,address beneficiary,address refundRecipient,bytes32 affiliateId,uint256 affiliateAmount,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant TASK_TERMS_TYPEHASH = keccak256(
        "AffiliateTaskTerms(uint256 duration,bytes4 mode,uint256 pitchDuration,uint256 bidDuration,bytes4 auctionSubtype,bool stakeRequired,uint16 stakeBps,uint16 feeBps,address evaluator,uint256 evaluatorStake,uint16 evaluatorFeeBps,uint32 evaluationWindow,uint32 appealWindow,address disputeResolver,bytes32 contentHash,bytes32 contentURIHash,bytes32 tagsHash,bytes32 hooksHash)"
    );

    address private payer;
    address private constant REQUESTER = address(0xCAFE);
    address private constant BENEFICIARY = address(0xBEEF);
    address private constant WORKER = address(0xD00D);

    MockTaskmarketForAffiliateHook private market;
    MockERC20 private token;
    AffiliateSidecarEscrowHook private hook;

    function setUp() public {
        payer = vm.addr(PAYER_PRIVATE_KEY);
        market = new MockTaskmarketForAffiliateHook();
        token = new MockERC20("Mock USDC", "USDC", 6, address(this));
        hook = new AffiliateSidecarEscrowHook(address(market));

        token.mint(payer, 10_000_000e6);
        vm.prank(payer);
        token.approve(address(hook), type(uint256).max);
    }

    function testFuzzFundStoresIndependentTaskAndAffiliateAmounts(uint64 taskAmountSeed, uint64 affiliateAmountSeed)
        public
    {
        uint256 taskAmount = bound(uint256(taskAmountSeed), 1, 1_000_000e6);
        uint256 affiliateAmount = bound(uint256(affiliateAmountSeed), 1, 1_000_000e6);

        uint256 payerBefore = token.balanceOf(payer);
        _fund(TASK_ID, taskAmount, affiliateAmount, 1);

        AffiliateSidecarEscrowHook.Allocation memory allocation = _allocation(TASK_ID);
        assertEq(allocation.taskAmount, taskAmount, "X is snapshotted independently");
        assertEq(allocation.affiliateAmount, affiliateAmount, "Y is snapshotted independently");
        assertEq(allocation.payer, payer);
        assertEq(allocation.requester, REQUESTER);
        assertEq(allocation.beneficiary, BENEFICIARY);
        assertEq(allocation.refundRecipient, REQUESTER);
        assertEq(allocation.paymentToken, address(token));
        assertEq(allocation.affiliateId, AFFILIATE_ID);
        assertEq(allocation.taskTermsHash, _taskTermsHash());
        assertEq(uint8(allocation.status), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));
        assertEq(token.balanceOf(payer), payerBefore - affiliateAmount);
        assertEq(token.balanceOf(address(hook)), affiliateAmount);
        assertEq(hook.totalLiability(address(token)), affiliateAmount);
    }

    function testCompletionCreditsAffiliateAndPermissionlessClaimPaysExactlyY() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 1);
        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Accepted);

        market.onComplete(hook, TASK_ID, _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Accepted), _verdict());
        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));

        uint256 beneficiaryBefore = token.balanceOf(BENEFICIARY);
        vm.prank(address(0x1234));
        (address recipient, uint256 amount) = hook.claim(TASK_ID);

        assertEq(recipient, BENEFICIARY);
        assertEq(amount, AFFILIATE_AMOUNT);
        assertEq(token.balanceOf(BENEFICIARY), beneficiaryBefore + AFFILIATE_AMOUNT);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(hook.totalLiability(address(token)), 0);
        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Paid));

        vm.expectRevert(
            abi.encodeWithSelector(
                AffiliateSidecarEscrowHook.AllocationNotClaimable.selector,
                TASK_ID,
                AffiliateSidecarEscrowHook.AllocationStatus.Paid
            )
        );
        hook.claim(TASK_ID);
    }

    function testCancelCreditsSignedRefundRecipient() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 1);
        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Cancelled);
        market.onCancel(hook, TASK_ID, _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Cancelled));

        uint256 refundRecipientBefore = token.balanceOf(REQUESTER);
        hook.claim(TASK_ID);

        assertEq(token.balanceOf(REQUESTER), refundRecipientBefore + AFFILIATE_AMOUNT);
        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Refunded));
    }

    function testExpireCreditsSignedRefundRecipient() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 1);
        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Expired);
        market.onExpire(hook, TASK_ID, _context(TASK_ID, 0, ITMPCore.TaskStatus.Expired));

        uint256 refundRecipientBefore = token.balanceOf(REQUESTER);
        hook.claim(TASK_ID);

        assertEq(token.balanceOf(REQUESTER), refundRecipientBefore + AFFILIATE_AMOUNT);
        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Refunded));
    }

    function testForfeitAndReopenLeavesAffiliateEscrowReserved() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 1);
        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Open);
        market.onForfeit(hook, TASK_ID, _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open), WORKER);

        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Escrowed));
        assertEq(token.balanceOf(address(hook)), AFFILIATE_AMOUNT);
        vm.expectRevert(
            abi.encodeWithSelector(
                AffiliateSidecarEscrowHook.TaskNotTerminal.selector, TASK_ID, ITMPCore.TaskStatus.Open
            )
        );
        hook.reconcile(TASK_ID);
    }

    function testReconcileRecoversMissedCompletionCallbackAndIsIdempotent() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 1);
        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Accepted);

        AffiliateSidecarEscrowHook.AllocationStatus first = hook.reconcile(TASK_ID);
        AffiliateSidecarEscrowHook.AllocationStatus second = hook.reconcile(TASK_ID);

        assertEq(uint8(first), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));
        assertEq(uint8(second), uint8(AffiliateSidecarEscrowHook.AllocationStatus.AffiliateClaimable));
        hook.claim(TASK_ID);
        assertEq(token.balanceOf(BENEFICIARY), AFFILIATE_AMOUNT);
    }

    function testClaimReconcilesMissedExpiryCallbackAndRefundsSignedRecipient() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 1);
        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Expired);

        uint256 refundRecipientBefore = token.balanceOf(REQUESTER);
        hook.claim(TASK_ID);

        assertEq(token.balanceOf(REQUESTER), refundRecipientBefore + AFFILIATE_AMOUNT);
        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.Refunded));
    }

    function testFundingDigestMatchesIndependentEIP712Construction() public view {
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 11);

        assertEq(hook.FUNDING_AUTHORIZATION_TYPEHASH(), FUNDING_AUTHORIZATION_TYPEHASH);
        bytes32 structHash = keccak256(
            abi.encode(
                FUNDING_AUTHORIZATION_TYPEHASH,
                TASK_ID,
                REQUESTER,
                address(token),
                TASK_AMOUNT,
                authorization.taskTermsHash,
                authorization.payer,
                authorization.beneficiary,
                authorization.refundRecipient,
                authorization.affiliateId,
                authorization.affiliateAmount,
                authorization.nonce,
                authorization.deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, EIP712_NAME_HASH, EIP712_VERSION_HASH, block.chainid, address(hook))
        );
        bytes32 expected = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));

        assertEq(hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization), expected);
    }

    function testTaskTermsHashMatchesIndependentConstruction() public view {
        AffiliateSidecarEscrowHook.TaskTerms memory terms = _taskTerms();
        assertEq(hook.TASK_TERMS_TYPEHASH(), TASK_TERMS_TYPEHASH);
        bytes32 expected = keccak256(
            abi.encode(
                TASK_TERMS_TYPEHASH,
                terms.duration,
                terms.mode,
                terms.pitchDuration,
                terms.bidDuration,
                terms.auctionSubtype,
                terms.stakeRequired,
                terms.stakeBps,
                terms.feeBps,
                terms.evaluator,
                terms.evaluatorStake,
                terms.evaluatorFeeBps,
                terms.evaluationWindow,
                terms.appealWindow,
                terms.disputeResolver,
                terms.contentHash,
                terms.contentURIHash,
                terms.tagsHash,
                terms.hooksHash
            )
        );

        assertEq(hook.taskTermsHash(terms), expected);
    }

    function testEncodeHookDataRoundTripsV1AuthorizationAndSignature() public view {
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 12);
        bytes memory signature = hex"1234567890abcdef";
        bytes memory encoded = hook.encodeHookData(authorization, signature);

        (uint8 version, AffiliateSidecarEscrowHook.FundingAuthorization memory decoded, bytes memory decodedSignature) =
            abi.decode(encoded, (uint8, AffiliateSidecarEscrowHook.FundingAuthorization, bytes));

        assertEq(version, HOOK_DATA_VERSION);
        assertEq(decoded.taskTermsHash, authorization.taskTermsHash);
        assertEq(decoded.payer, authorization.payer);
        assertEq(decoded.beneficiary, authorization.beneficiary);
        assertEq(decoded.refundRecipient, authorization.refundRecipient);
        assertEq(decoded.affiliateId, authorization.affiliateId);
        assertEq(decoded.affiliateAmount, authorization.affiliateAmount);
        assertEq(decoded.nonce, authorization.nonce);
        assertEq(decoded.deadline, authorization.deadline);
        assertEq(keccak256(decodedSignature), keccak256(signature));
    }

    function testFundingRejectsInvalidSignature() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 1);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        bytes memory signature = _sign(WRONG_PRIVATE_KEY, digest);

        vm.expectRevert(AffiliateSidecarEscrowHook.InvalidFundingSignature.selector);
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, signature)
        );
    }

    function testFundingSignatureBindsTaskAmountX() public {
        _configureTask(TASK_ID, TASK_AMOUNT + 1);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 1);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        bytes memory signature = _sign(PAYER_PRIVATE_KEY, digest);

        vm.expectRevert(AffiliateSidecarEscrowHook.InvalidFundingSignature.selector);
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT + 1, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, signature)
        );
    }

    function testFundingSignatureBindsAffiliateAmountY() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 1);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        bytes memory signature = _sign(PAYER_PRIVATE_KEY, digest);
        authorization.affiliateAmount += 1;

        vm.expectRevert(AffiliateSidecarEscrowHook.InvalidFundingSignature.selector);
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, signature)
        );
    }

    function testFundingRejectsSignedTaskTermsWhenCreatedTaskTermsDiffer() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 1);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        bytes memory signature = _sign(PAYER_PRIVATE_KEY, digest);

        market.setTaskContentHash(TASK_ID, keccak256("tampered-content"));
        bytes32 actualTaskTermsHash = hook.currentTaskTermsHash(TASK_ID);
        assertTrue(actualTaskTermsHash != authorization.taskTermsHash);

        vm.expectRevert(
            abi.encodeWithSelector(
                AffiliateSidecarEscrowHook.TaskTermsMismatch.selector, authorization.taskTermsHash, actualTaskTermsHash
            )
        );
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, signature)
        );
    }

    function testFundingAcceptsERC1271ContractPayer() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        address owner = vm.addr(ERC1271_OWNER_PRIVATE_KEY);
        ERC1271WalletMock contractPayer = new ERC1271WalletMock(owner);
        token.mint(address(contractPayer), AFFILIATE_AMOUNT);
        vm.prank(address(contractPayer));
        token.approve(address(hook), AFFILIATE_AMOUNT);

        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization =
            _authorizationFor(address(contractPayer), AFFILIATE_AMOUNT, 21);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        bytes memory hookData = hook.encodeHookData(authorization, _sign(ERC1271_OWNER_PRIVATE_KEY, digest));

        assertTrue(market.checkFund(hook, TASK_ID, _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open), hookData));
        AffiliateSidecarEscrowHook.Allocation memory allocation = _allocation(TASK_ID);
        assertEq(allocation.payer, address(contractPayer));
        assertEq(token.balanceOf(address(contractPayer)), 0);
        assertEq(token.balanceOf(address(hook)), AFFILIATE_AMOUNT);
        assertEq(hook.totalLiability(address(token)), AFFILIATE_AMOUNT);
    }

    function testFundingRejectsExpiredAuthorization() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 1);
        authorization.deadline = block.timestamp - 1;
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);

        vm.expectRevert(
            abi.encodeWithSelector(AffiliateSidecarEscrowHook.AuthorizationExpired.selector, authorization.deadline)
        );
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );
    }

    function testFundingRejectsReusedOrInvalidatedNonce() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        vm.prank(payer);
        hook.invalidateAuthorization(7);

        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 7);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        vm.expectRevert(abi.encodeWithSelector(AffiliateSidecarEscrowHook.AuthorizationAlreadyUsed.selector, payer, 7));
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );
    }

    function testFundingRejectsInsufficientAllowanceWithoutCreatingLiability() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        vm.prank(payer);
        token.approve(address(hook), 0);

        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 1);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);
        vm.expectRevert();
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );

        assertEq(uint8(_status(TASK_ID)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.None));
        assertFalse(hook.usedNonces(payer, 1));
        assertEq(hook.totalLiability(address(token)), 0);
    }

    function testSuccessfulFundingConsumesNonceAcrossTasks() public {
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 31);

        bytes32 secondTaskId = keccak256("affiliate-sidecar-second-task");
        _configureTask(secondTaskId, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 31);
        bytes32 digest = hook.fundingDigest(secondTaskId, REQUESTER, address(token), TASK_AMOUNT, authorization);

        vm.expectRevert(abi.encodeWithSelector(AffiliateSidecarEscrowHook.AuthorizationAlreadyUsed.selector, payer, 31));
        market.checkFund(
            hook,
            secondTaskId,
            _context(secondTaskId, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );

        assertEq(uint8(_status(secondTaskId)), uint8(AffiliateSidecarEscrowHook.AllocationStatus.None));
        assertEq(hook.totalLiability(address(token)), AFFILIATE_AMOUNT);
    }

    function testFundingRejectsHookAsBeneficiary() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 32);
        authorization.beneficiary = address(hook);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);

        vm.expectRevert(AffiliateSidecarEscrowHook.InvalidBeneficiary.selector);
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );
    }

    function testFundingRejectsHookAsRefundRecipient() public {
        _configureTask(TASK_ID, TASK_AMOUNT);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(AFFILIATE_AMOUNT, 33);
        authorization.refundRecipient = address(hook);
        bytes32 digest = hook.fundingDigest(TASK_ID, REQUESTER, address(token), TASK_AMOUNT, authorization);

        vm.expectRevert(AffiliateSidecarEscrowHook.InvalidRefundRecipient.selector);
        market.checkFund(
            hook,
            TASK_ID,
            _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );
    }

    function testAggregateLiabilityTracksMultipleTasksThroughBothSettlementPaths() public {
        bytes32 secondTaskId = keccak256("affiliate-sidecar-second-task");
        uint256 secondAffiliateAmount = 7e6;
        _fund(TASK_ID, TASK_AMOUNT, AFFILIATE_AMOUNT, 41);
        _fund(secondTaskId, TASK_AMOUNT + 5e6, secondAffiliateAmount, 42);

        assertEq(hook.totalLiability(address(token)), AFFILIATE_AMOUNT + secondAffiliateAmount);
        assertEq(token.balanceOf(address(hook)), AFFILIATE_AMOUNT + secondAffiliateAmount);

        market.setTaskStatus(TASK_ID, ITMPCore.TaskStatus.Accepted);
        hook.claim(TASK_ID);
        assertEq(hook.totalLiability(address(token)), secondAffiliateAmount);
        assertEq(token.balanceOf(BENEFICIARY), AFFILIATE_AMOUNT);

        market.setTaskStatus(secondTaskId, ITMPCore.TaskStatus.Cancelled);
        hook.claim(secondTaskId);
        assertEq(hook.totalLiability(address(token)), 0);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(token.balanceOf(REQUESTER), secondAffiliateAmount);
    }

    function testOnlyConfiguredTaskmarketCanCallLifecycleCallbacks() public {
        vm.expectRevert(abi.encodeWithSelector(BaseTMPHook.BaseTMPHook__UnauthorizedCaller.selector, address(this)));
        hook.checkClaim(TASK_ID, _context(TASK_ID, TASK_AMOUNT, ITMPCore.TaskStatus.Open), WORKER);
    }

    function _fund(bytes32 taskId, uint256 taskAmount, uint256 affiliateAmount, uint256 nonce) private {
        _configureTask(taskId, taskAmount);
        AffiliateSidecarEscrowHook.FundingAuthorization memory authorization = _authorization(affiliateAmount, nonce);
        bytes32 digest = hook.fundingDigest(taskId, REQUESTER, address(token), taskAmount, authorization);
        bool accepted = market.checkFund(
            hook,
            taskId,
            _context(taskId, taskAmount, ITMPCore.TaskStatus.Open),
            abi.encode(HOOK_DATA_VERSION, authorization, _sign(PAYER_PRIVATE_KEY, digest))
        );
        assertTrue(accepted);
    }

    function _configureTask(bytes32 taskId, uint256 taskAmount) private {
        uint256 createdAt = block.timestamp;

        ITMPCore.Task memory task;
        task.id = taskId;
        task.requester = REQUESTER;
        task.status = ITMPCore.TaskStatus.Open;
        task.mode = MODE;
        task.reward = taskAmount;
        task.expiryTime = createdAt + DURATION;
        task.feeBps = FEE_BPS;
        market.setTask(task);

        market.setTaskMetadata(
            taskId,
            ITMPCore.TaskMetadata({
                createdAt: createdAt, claimedAt: 0, contentHash: CONTENT_HASH, contentURI: CONTENT_URI
            })
        );
        market.setTaskEvaluatorConfig(
            taskId,
            ITMPCore.TaskEvaluatorConfig({
                evaluator: address(0),
                evaluatorStake: 0,
                evaluatorFeeBps: 0,
                evaluationWindow: 0,
                appealWindow: 0,
                disputeResolver: address(0)
            })
        );
        market.setTaskAuctionConfig(
            taskId,
            ITMPCore.TaskAuctionConfig({
                bidDeadline: 0, maxPrice: 0, auctionSubtype: bytes4(0), lowestBidder: address(0), lowestBidPrice: 0
            })
        );
        market.setTaskPitchConfig(taskId, ITMPCore.TaskPitchConfig({pitchDeadline: 0}));
        market.setTaskHooks(taskId, _hooks());
        market.setTaskTags(taskId, _tags());
        market.setTaskPaymentToken(taskId, address(token));
    }

    function _authorization(uint256 affiliateAmount, uint256 nonce)
        private
        view
        returns (AffiliateSidecarEscrowHook.FundingAuthorization memory)
    {
        return _authorizationFor(payer, affiliateAmount, nonce);
    }

    function _authorizationFor(address fundingPayer, uint256 affiliateAmount, uint256 nonce)
        private
        view
        returns (AffiliateSidecarEscrowHook.FundingAuthorization memory)
    {
        return AffiliateSidecarEscrowHook.FundingAuthorization({
            taskTermsHash: _taskTermsHash(),
            payer: fundingPayer,
            beneficiary: BENEFICIARY,
            refundRecipient: REQUESTER,
            affiliateId: AFFILIATE_ID,
            affiliateAmount: affiliateAmount,
            nonce: nonce,
            deadline: block.timestamp + 1 days
        });
    }

    function _context(bytes32 taskId, uint256 taskAmount, ITMPCore.TaskStatus status)
        private
        view
        returns (ITMPCore.TaskContext memory ctx)
    {
        ctx.taskId = taskId;
        ctx.requester = REQUESTER;
        ctx.paymentToken = address(token);
        ctx.reward = taskAmount;
        ctx.currentState = status;
        ctx.mode = MODE;
        ctx.tags = _tags();
    }

    function _taskTermsHash() private view returns (bytes32) {
        return hook.taskTermsHash(_taskTerms());
    }

    function _taskTerms() private view returns (AffiliateSidecarEscrowHook.TaskTerms memory terms) {
        terms.duration = DURATION;
        terms.mode = MODE;
        terms.feeBps = FEE_BPS;
        terms.contentHash = CONTENT_HASH;
        terms.contentURIHash = keccak256(bytes(CONTENT_URI));
        terms.tagsHash = keccak256(abi.encode(_tags()));
        terms.hooksHash = keccak256(abi.encode(_hooks()));
    }

    function _tags() private pure returns (bytes32[] memory tags) {
        tags = new bytes32[](2);
        tags[0] = TAG_ONE;
        tags[1] = TAG_TWO;
    }

    function _hooks() private view returns (address[] memory hooks) {
        hooks = new address[](1);
        hooks[0] = address(hook);
    }

    function _verdict() private pure returns (ITMPCore.Verdict memory verdict) {
        verdict.issued = true;
        verdict.verdictType = ITMPCore.VerdictType.APPROVE;
        verdict.criteriaFlags = new bytes32[](0);
        verdict.awards = new ITMPCore.Award[](0);
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

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
