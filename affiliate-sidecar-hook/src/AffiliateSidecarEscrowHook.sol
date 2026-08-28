// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITMPCore} from "@taskmarket/contracts/src/interfaces/ITMPCore.sol";
import {ITMPDiamond} from "@taskmarket/contracts/src/interfaces/ITMPDiamond.sol";
import {BaseTMPHook} from "@taskmarket/contracts/src/hooks/base/BaseTMPHook.sol";

/// @title AffiliateSidecarEscrowHook
/// @notice Adds an independently funded affiliate reward to a Taskmarket task.
/// @dev Taskmarket continues to escrow the task reward (X). This hook atomically pulls a separately
///      authorized affiliate amount (Y) during checkFund and escrows it until the task reaches a
///      terminal state. Accepted tasks pay Y to the snapshotted beneficiary; cancelled or expired
///      tasks refund Y to the payer-signed refund recipient. Claims are pull-based and callbacks
///      never transfer tokens.
contract AffiliateSidecarEscrowHook is BaseTMPHook, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant HOOK_DATA_VERSION = 1;

    bytes32 public constant FUNDING_AUTHORIZATION_TYPEHASH = keccak256(
        "AffiliateFunding(bytes32 taskId,address requester,address paymentToken,uint256 taskAmount,bytes32 taskTermsHash,address payer,address beneficiary,address refundRecipient,bytes32 affiliateId,uint256 affiliateAmount,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant TASK_TERMS_TYPEHASH = keccak256(
        "AffiliateTaskTerms(uint256 duration,bytes4 mode,uint256 pitchDuration,uint256 bidDuration,bytes4 auctionSubtype,bool stakeRequired,uint16 stakeBps,uint16 feeBps,address evaluator,uint256 evaluatorStake,uint16 evaluatorFeeBps,uint32 evaluationWindow,uint32 appealWindow,address disputeResolver,bytes32 contentHash,bytes32 contentURIHash,bytes32 tagsHash,bytes32 hooksHash)"
    );

    enum AllocationStatus {
        None,
        Escrowed,
        AffiliateClaimable,
        RefundClaimable,
        Paid,
        Refunded
    }

    /// @notice User-selected affiliate funding terms supplied through Taskmarket hookData.
    /// @dev The payer signs these values inside AffiliateFunding, which also binds the task identity,
    ///      payment token, task amount, requester, and canonical creation-time task terms.
    struct FundingAuthorization {
        bytes32 taskTermsHash;
        address payer;
        address beneficiary;
        address refundRecipient;
        bytes32 affiliateId;
        uint256 affiliateAmount;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Canonical creation-time task terms committed by the payer.
    /// @dev Dynamic values are represented by hashes so the result is identical onchain and offchain.
    struct TaskTerms {
        uint256 duration;
        bytes4 mode;
        uint256 pitchDuration;
        uint256 bidDuration;
        bytes4 auctionSubtype;
        bool stakeRequired;
        uint16 stakeBps;
        uint16 feeBps;
        address evaluator;
        uint256 evaluatorStake;
        uint16 evaluatorFeeBps;
        uint32 evaluationWindow;
        uint32 appealWindow;
        address disputeResolver;
        bytes32 contentHash;
        bytes32 contentURIHash;
        bytes32 tagsHash;
        bytes32 hooksHash;
    }

    /// @notice Immutable X/Y allocation snapshot for one task.
    struct Allocation {
        address payer;
        address requester;
        address beneficiary;
        address refundRecipient;
        address paymentToken;
        bytes32 affiliateId;
        bytes32 taskTermsHash;
        uint256 taskAmount;
        uint256 affiliateAmount;
        AllocationStatus status;
    }

    mapping(bytes32 taskId => Allocation allocation) public allocations;
    mapping(address payer => mapping(uint256 nonce => bool used)) public usedNonces;
    mapping(address paymentToken => uint256 amount) public totalLiability;

    error AllocationAlreadyExists(bytes32 taskId);
    error AllocationNotFound(bytes32 taskId);
    error AllocationNotClaimable(bytes32 taskId, AllocationStatus status);
    error AuthorizationAlreadyUsed(address payer, uint256 nonce);
    error AuthorizationExpired(uint256 deadline);
    error ConflictingResolution(bytes32 taskId, AllocationStatus status);
    error InvalidAffiliateAmount();
    error InvalidBeneficiary();
    error InvalidFundingSignature();
    error InvalidHookContext();
    error InvalidHookDataVersion(uint8 provided);
    error InvalidPayer();
    error InvalidRefundRecipient();
    error TaskMismatch(bytes32 taskId);
    error TaskNotTerminal(bytes32 taskId, ITMPCore.TaskStatus status);
    error TaskTermsMismatch(bytes32 expected, bytes32 actual);
    error TokenTransferAmountMismatch(uint256 expected, uint256 received);

    event AffiliateEscrowFunded(
        bytes32 indexed taskId,
        bytes32 indexed affiliateId,
        address indexed beneficiary,
        address payer,
        address requester,
        address refundRecipient,
        address paymentToken,
        bytes32 taskTermsHash,
        uint256 taskAmount,
        uint256 affiliateAmount
    );
    event AffiliateEscrowResolved(
        bytes32 indexed taskId, AllocationStatus indexed status, address indexed recipient, uint256 amount
    );
    event AffiliatePaid(
        bytes32 indexed taskId, address indexed beneficiary, address indexed paymentToken, uint256 amount
    );
    event AffiliateRefunded(
        bytes32 indexed taskId, address indexed refundRecipient, address indexed paymentToken, uint256 amount
    );
    event AuthorizationInvalidated(address indexed payer, uint256 indexed nonce);

    constructor(address taskmarket_) BaseTMPHook(taskmarket_) EIP712("AffiliateSidecarEscrowHook", "1") {}

    /// @notice Returns the EIP-712 digest that the sidecar payer must sign.
    function fundingDigest(
        bytes32 taskId,
        address requester,
        address paymentToken,
        uint256 taskAmount,
        FundingAuthorization calldata authorization
    ) external view returns (bytes32) {
        return _fundingDigest(taskId, requester, paymentToken, taskAmount, authorization);
    }

    /// @notice Hashes the canonical task-creation terms included in the payer authorization.
    function taskTermsHash(TaskTerms calldata terms) external pure returns (bytes32) {
        return _taskTermsHash(terms);
    }

    /// @notice Returns the terms hash reconstructed from an already-created Taskmarket task.
    /// @dev Mutable task fields can make this differ from the allocation's creation-time snapshot after an update.
    function currentTaskTermsHash(bytes32 taskId) external view returns (bytes32) {
        return _currentTaskTermsHash(taskId, ITMPDiamond(diamond).getTaskContext(taskId));
    }

    /// @notice Encodes the V1 payload supplied as Taskmarket's shared hookData value.
    function encodeHookData(FundingAuthorization calldata authorization, bytes calldata signature)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(HOOK_DATA_VERSION, authorization, signature);
    }

    /// @notice Invalidates an unused authorization nonce for the caller.
    function invalidateAuthorization(uint256 nonce) external {
        if (usedNonces[msg.sender][nonce]) revert AuthorizationAlreadyUsed(msg.sender, nonce);
        usedNonces[msg.sender][nonce] = true;
        emit AuthorizationInvalidated(msg.sender, nonce);
    }

    /// @notice Rebuilds claimable state from Taskmarket when a best-effort callback was missed.
    /// @dev Idempotent after resolution. Reverts while the task is still non-terminal.
    function reconcile(bytes32 taskId) external nonReentrant returns (AllocationStatus) {
        return _reconcile(taskId);
    }

    /// @notice Sends a resolved allocation to its predetermined recipient.
    /// @dev Anyone may trigger a claim; funds can only go to the beneficiary or signed refund recipient.
    function claim(bytes32 taskId) external nonReentrant returns (address recipient, uint256 amount) {
        Allocation storage allocation = allocations[taskId];
        if (allocation.status == AllocationStatus.None) revert AllocationNotFound(taskId);
        if (allocation.status == AllocationStatus.Escrowed) _reconcile(taskId);

        AllocationStatus status = allocation.status;
        if (status == AllocationStatus.AffiliateClaimable) {
            recipient = allocation.beneficiary;
            allocation.status = AllocationStatus.Paid;
        } else if (status == AllocationStatus.RefundClaimable) {
            recipient = allocation.refundRecipient;
            allocation.status = AllocationStatus.Refunded;
        } else {
            revert AllocationNotClaimable(taskId, status);
        }

        amount = allocation.affiliateAmount;
        address paymentToken = allocation.paymentToken;
        totalLiability[paymentToken] -= amount;

        if (status == AllocationStatus.AffiliateClaimable) {
            emit AffiliatePaid(taskId, recipient, paymentToken, amount);
        } else {
            emit AffiliateRefunded(taskId, recipient, paymentToken, amount);
        }
        IERC20(paymentToken).safeTransfer(recipient, amount);
    }

    function _checkFund(bytes32 taskId, ITMPCore.TaskContext calldata ctx, bytes calldata hookData)
        internal
        override
        nonReentrant
        returns (bool)
    {
        if (
            taskId != ctx.taskId || ctx.requester == address(0) || ctx.paymentToken == address(0) || ctx.reward == 0
                || ctx.currentState != ITMPCore.TaskStatus.Open
        ) revert InvalidHookContext();
        if (allocations[taskId].status != AllocationStatus.None) revert AllocationAlreadyExists(taskId);

        (uint8 version, FundingAuthorization memory authorization, bytes memory signature) =
            abi.decode(hookData, (uint8, FundingAuthorization, bytes));
        if (version != HOOK_DATA_VERSION) revert InvalidHookDataVersion(version);
        if (authorization.payer == address(0)) revert InvalidPayer();
        if (authorization.beneficiary == address(0) || authorization.beneficiary == address(this)) {
            revert InvalidBeneficiary();
        }
        if (authorization.refundRecipient == address(0) || authorization.refundRecipient == address(this)) {
            revert InvalidRefundRecipient();
        }
        if (authorization.affiliateAmount == 0) revert InvalidAffiliateAmount();
        // A signed expiry is intentionally timestamp-based; small sequencer skew cannot redirect funds.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired(authorization.deadline);
        if (usedNonces[authorization.payer][authorization.nonce]) {
            revert AuthorizationAlreadyUsed(authorization.payer, authorization.nonce);
        }

        bytes32 digest = _fundingDigest(taskId, ctx.requester, ctx.paymentToken, ctx.reward, authorization);
        if (!SignatureChecker.isValidSignatureNow(authorization.payer, digest, signature)) {
            revert InvalidFundingSignature();
        }
        bytes32 actualTaskTermsHash = _currentTaskTermsHash(taskId, ctx);
        if (authorization.taskTermsHash != actualTaskTermsHash) {
            revert TaskTermsMismatch(authorization.taskTermsHash, actualTaskTermsHash);
        }

        usedNonces[authorization.payer][authorization.nonce] = true;
        allocations[taskId] = Allocation({
            payer: authorization.payer,
            requester: ctx.requester,
            beneficiary: authorization.beneficiary,
            refundRecipient: authorization.refundRecipient,
            paymentToken: ctx.paymentToken,
            affiliateId: authorization.affiliateId,
            taskTermsHash: authorization.taskTermsHash,
            taskAmount: ctx.reward,
            affiliateAmount: authorization.affiliateAmount,
            status: AllocationStatus.Escrowed
        });
        totalLiability[ctx.paymentToken] += authorization.affiliateAmount;

        IERC20 token = IERC20(ctx.paymentToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(authorization.payer, address(this), authorization.affiliateAmount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != authorization.affiliateAmount) {
            revert TokenTransferAmountMismatch(authorization.affiliateAmount, received);
        }

        emit AffiliateEscrowFunded(
            taskId,
            authorization.affiliateId,
            authorization.beneficiary,
            authorization.payer,
            ctx.requester,
            authorization.refundRecipient,
            ctx.paymentToken,
            authorization.taskTermsHash,
            ctx.reward,
            authorization.affiliateAmount
        );
        return true;
    }

    function _onComplete(bytes32 taskId, ITMPCore.TaskContext calldata, ITMPCore.Verdict calldata) internal override {
        _resolveAffiliate(taskId);
    }

    function _onCancel(bytes32 taskId, ITMPCore.TaskContext calldata) internal override {
        _resolveRefund(taskId);
    }

    function _onExpire(bytes32 taskId, ITMPCore.TaskContext calldata) internal override {
        _resolveRefund(taskId);
    }

    function _reconcile(bytes32 taskId) private returns (AllocationStatus) {
        Allocation storage allocation = allocations[taskId];
        AllocationStatus status = allocation.status;
        if (status == AllocationStatus.None) revert AllocationNotFound(taskId);
        if (status != AllocationStatus.Escrowed) return status;

        ITMPCore.Task memory task = ITMPCore(diamond).getTask(taskId);
        if (task.id != taskId || task.requester != allocation.requester) revert TaskMismatch(taskId);

        if (task.status == ITMPCore.TaskStatus.Accepted) {
            _resolveAffiliate(taskId);
        } else if (task.status == ITMPCore.TaskStatus.Cancelled || task.status == ITMPCore.TaskStatus.Expired) {
            _resolveRefund(taskId);
        } else {
            revert TaskNotTerminal(taskId, task.status);
        }
        return allocation.status;
    }

    function _resolveAffiliate(bytes32 taskId) private {
        Allocation storage allocation = allocations[taskId];
        AllocationStatus status = allocation.status;
        if (status == AllocationStatus.AffiliateClaimable || status == AllocationStatus.Paid) return;
        if (status != AllocationStatus.Escrowed) revert ConflictingResolution(taskId, status);

        allocation.status = AllocationStatus.AffiliateClaimable;
        emit AffiliateEscrowResolved(
            taskId, AllocationStatus.AffiliateClaimable, allocation.beneficiary, allocation.affiliateAmount
        );
    }

    function _resolveRefund(bytes32 taskId) private {
        Allocation storage allocation = allocations[taskId];
        AllocationStatus status = allocation.status;
        if (status == AllocationStatus.RefundClaimable || status == AllocationStatus.Refunded) return;
        if (status != AllocationStatus.Escrowed) revert ConflictingResolution(taskId, status);

        allocation.status = AllocationStatus.RefundClaimable;
        emit AffiliateEscrowResolved(
            taskId, AllocationStatus.RefundClaimable, allocation.refundRecipient, allocation.affiliateAmount
        );
    }

    function _fundingDigest(
        bytes32 taskId,
        address requester,
        address paymentToken,
        uint256 taskAmount,
        FundingAuthorization memory authorization
    ) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    FUNDING_AUTHORIZATION_TYPEHASH,
                    taskId,
                    requester,
                    paymentToken,
                    taskAmount,
                    authorization.taskTermsHash,
                    authorization.payer,
                    authorization.beneficiary,
                    authorization.refundRecipient,
                    authorization.affiliateId,
                    authorization.affiliateAmount,
                    authorization.nonce,
                    authorization.deadline
                )
            )
        );
    }

    function _currentTaskTermsHash(bytes32 taskId, ITMPCore.TaskContext memory ctx) private view returns (bytes32) {
        ITMPDiamond market = ITMPDiamond(diamond);
        ITMPCore.Task memory task = market.getTask(taskId);
        ITMPCore.TaskMetadata memory metadata = market.getTaskMetadata(taskId);
        ITMPCore.TaskEvaluatorConfig memory evaluator = market.getTaskEvaluatorConfig(taskId);
        ITMPCore.TaskAuctionConfig memory auction = market.getTaskAuctionConfig(taskId);
        ITMPCore.TaskPitchConfig memory pitch = market.getTaskPitchConfig(taskId);
        address[] memory hooks = market.getTaskHooks(taskId);

        if (
            task.id != taskId || task.requester != ctx.requester || task.reward != ctx.reward || task.mode != ctx.mode
                || task.expiryTime < metadata.createdAt
        ) revert InvalidHookContext();
        if (pitch.pitchDeadline != 0 && pitch.pitchDeadline < metadata.createdAt) revert InvalidHookContext();
        if (auction.bidDeadline != 0 && auction.bidDeadline < metadata.createdAt) revert InvalidHookContext();

        TaskTerms memory terms = TaskTerms({
            duration: task.expiryTime - metadata.createdAt,
            mode: task.mode,
            pitchDuration: pitch.pitchDeadline == 0 ? 0 : pitch.pitchDeadline - metadata.createdAt,
            bidDuration: auction.bidDeadline == 0 ? 0 : auction.bidDeadline - metadata.createdAt,
            auctionSubtype: auction.auctionSubtype,
            stakeRequired: task.stakeRequired,
            stakeBps: task.stakeBps,
            feeBps: task.feeBps,
            evaluator: evaluator.evaluator,
            evaluatorStake: evaluator.evaluatorStake,
            evaluatorFeeBps: evaluator.evaluatorFeeBps,
            evaluationWindow: evaluator.evaluationWindow,
            appealWindow: evaluator.appealWindow,
            disputeResolver: evaluator.disputeResolver,
            contentHash: metadata.contentHash,
            contentURIHash: keccak256(bytes(metadata.contentURI)),
            tagsHash: keccak256(abi.encode(ctx.tags)),
            hooksHash: keccak256(abi.encode(hooks))
        });
        return _taskTermsHash(terms);
    }

    function _taskTermsHash(TaskTerms memory terms) private pure returns (bytes32) {
        return keccak256(
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
    }
}
