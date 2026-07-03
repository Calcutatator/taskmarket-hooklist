// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ITMPHook } from "../interfaces/ITMPHook.sol";
import { ITMPCore } from "../interfaces/ITMPCore.sol";
import { ITokenUsdOracle, PriceData } from "../interfaces/ITokenUsdOracle.sol";
import { IRewardVault } from "../interfaces/IRewardVault.sol";
import { EpochBudget } from "./EpochBudget.sol";
import { FullMath } from "../lib/FullMath.sol";

/// @title TaskTokenRewardHook
/// @notice Hook that pays DREAMS tokens to workers on task completion.
///         Rewards are priced in USD (using the task's USDC reward value) and
///         converted to tokens at the Aerodrome CL TWAP rate.
///
///         For Claim / Pitch / Auction tasks: price locks when worker is selected,
///         tokens are reserved from the vault, and paid atomically at completion.
///
///         For Bounty tasks: price and payment happen atomically at completion,
///         with no pre-reservation.
contract TaskTokenRewardHook is ITMPHook, Ownable {
    struct RewardState {
        uint256 rewardUsd; // USDC 6-decimal amount (= task reward)
        uint256 startPrice; // TOKEN per USDC at lock time, 1e18
        uint256 minSettlePrice; // startPrice * (10000 - driftBandBps) / 10000
        uint256 maxSettlePrice; // startPrice * (10000 + driftBandBps) / 10000
        uint256 reservedTokenAmount; // max tokens reserved from vault
        address requester;
        address worker;
        bool reserved; // true for Claim/Pitch/Auction (pre-reserved)
        bool paid;
    }

    ITokenUsdOracle public oracle;
    IRewardVault public vault;
    EpochBudget public epochBudget;
    address public diamond; // TaskMarket Diamond proxy for registry lookups
    uint16 public driftBandBps; // default 2000 = 20%
    uint8 public immutable tokenDecimals;

    // 10^(tokenDecimals + 12) bridges 6-decimal USDC → 18-decimal price space
    uint256 public immutable priceScaler;

    mapping(bytes32 => RewardState) public rewardStates;

    event RewardConfigured(bytes32 indexed taskId, uint256 rewardUsd);
    event RewardReserved(bytes32 indexed taskId, address indexed worker, uint256 startPrice, uint256 reservedAmount);
    event RewardPaid(
        bytes32 indexed taskId,
        address indexed worker,
        uint256 rewardUsd,
        uint256 settlePrice,
        uint256 effectivePrice,
        uint256 tokenAmount
    );
    event RewardReserveReleased(bytes32 indexed taskId, uint256 releasedAmount);

    error OracleInvalid();
    error RewardAlreadyPaid(bytes32 taskId);
    error RewardNotReserved(bytes32 taskId);
    error WorkerMismatch(bytes32 taskId, address expected, address got);
    error NoWorkerFound(bytes32 taskId);
    error DriftBandBpsTooHigh();
    error CallerNotDiamond();
    error OraclePriceTooLow();

    modifier onlyDiamond() {
        if (msg.sender != diamond) revert CallerNotDiamond();
        _;
    }

    constructor(
        address _oracle,
        address _vault,
        address _epochBudget,
        address _diamond,
        uint8 _tokenDecimals,
        uint16 _driftBandBps,
        address _owner
    ) Ownable(_owner) {
        if (_driftBandBps >= 10000) revert DriftBandBpsTooHigh();
        if (_oracle == address(0) || _vault == address(0) || _epochBudget == address(0) || _diamond == address(0)) {
            revert OracleInvalid();
        }
        oracle = ITokenUsdOracle(_oracle);
        vault = IRewardVault(_vault);
        epochBudget = EpochBudget(_epochBudget);
        diamond = _diamond;
        tokenDecimals = _tokenDecimals;
        driftBandBps = _driftBandBps;
        // scaler: bridges 6-decimal USDC amount to tokenDecimals-precision reward
        priceScaler = 10 ** (uint256(_tokenDecimals) + 12);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ITMPHook — check hooks (revert to block, return false not used)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Validate config at task creation and store initial state.
    ///         hookData is ignored — all config lives on this contract.
    function checkFund(
        bytes32 taskId,
        ITMPCore.TaskContext calldata ctx,
        bytes calldata /* hookData */
    )
        external
        override
        onlyDiamond
        returns (bool)
    {
        PriceData memory price = oracle.getPrice();
        if (!price.valid) revert OracleInvalid();

        rewardStates[taskId] = RewardState({
            rewardUsd: ctx.reward,
            startPrice: 0,
            minSettlePrice: 0,
            maxSettlePrice: 0,
            reservedTokenAmount: 0,
            requester: ctx.requester,
            worker: address(0),
            reserved: false,
            paid: false
        });

        emit RewardConfigured(taskId, ctx.reward);
        return true;
    }

    /// @notice Lock price and reserve max tokens when a worker claims (Claim mode).
    function checkClaim(bytes32 taskId, ITMPCore.TaskContext calldata ctx, address worker)
        external
        override
        onlyDiamond
        returns (bool)
    {
        return _reserveForWorker(taskId, ctx.requester, worker);
    }

    /// @notice Lock price and reserve max tokens when a worker is selected (Pitch/Auction).
    function checkSelectWorker(bytes32 taskId, ITMPCore.TaskContext calldata ctx, address worker)
        external
        override
        onlyDiamond
        returns (bool)
    {
        return _reserveForWorker(taskId, ctx.requester, worker);
    }

    /// @notice For reserved tasks, verify the submitting worker matches the locked worker.
    function checkSubmit(
        bytes32 taskId,
        ITMPCore.TaskContext calldata,
        /* ctx */
        address worker,
        bytes32 /* deliverableHash */
    )
        external
        view
        override
        onlyDiamond
        returns (bool)
    {
        RewardState storage state = rewardStates[taskId];
        if (state.reserved && state.worker != worker) {
            revert WorkerMismatch(taskId, state.worker, worker);
        }
        return true;
    }

    /// @notice Not used — return true.
    function checkEvaluate(
        bytes32,
        /* taskId */
        ITMPCore.TaskContext calldata,
        /* ctx */
        address /* evaluator */
    )
        external
        view
        override
        onlyDiamond
        returns (bool)
    {
        return true;
    }

    /// @notice Atomic token payout at task completion.
    ///         Path A (reserved): settle with clamped price, release unused reserve.
    ///                            Falls back to startPrice if oracle is currently invalid.
    ///         Path B (Bounty):   pay each winner proportionally using verdict.awards.
    ///                            Skips token bonus gracefully if oracle is unavailable or
    ///                            vault/budget is exhausted — USDC payout is never blocked.
    function checkComplete(bytes32 taskId, ITMPCore.TaskContext calldata ctx, ITMPCore.Verdict calldata verdict)
        external
        override
        onlyDiamond
        returns (bool)
    {
        RewardState storage state = rewardStates[taskId];

        if (state.paid) revert RewardAlreadyPaid(taskId);

        PriceData memory settlePrice = oracle.getPrice();

        // Effects before interactions: mark paid up front so a token-transfer
        // callback cannot re-enter and double-pay.
        state.paid = true;

        if (state.reserved) {
            // Path A — Claim / Pitch / Auction
            // Budget was already consumed for state.reservedTokenAmount at lock time (_reserveForWorker).
            // Do NOT call checkAndConsume again; instead pay the actual (smaller) amount and
            // release the surplus back to the budget.
            // Fall back to startPrice if oracle is currently invalid to avoid blocking settlement.
            uint256 currentPrice = settlePrice.valid ? settlePrice.price : state.startPrice;
            uint256 effectivePrice = _clamp(currentPrice, state.minSettlePrice, state.maxSettlePrice);
            uint256 rawReward = FullMath.mulDiv(state.rewardUsd, priceScaler, effectivePrice);
            uint256 tokenReward = rawReward < state.reservedTokenAmount ? rawReward : state.reservedTokenAmount;

            // Wrap vault.pay: if the token transfer fails (e.g. token paused), release the
            // reserve and let the USDC payout proceed rather than blocking settlement.
            bool paid = false;
            try vault.pay(taskId, state.worker, tokenReward) {
                paid = true;
            } catch { }

            if (!paid) {
                tokenReward = state.reservedTokenAmount;
                try vault.release(taskId, tokenReward) { } catch { }
                try epochBudget.release(state.requester, state.worker, tokenReward) { } catch { }
                return true;
            }

            uint256 unused = state.reservedTokenAmount - tokenReward;
            if (unused > 0) {
                vault.release(taskId, unused);
                epochBudget.release(state.requester, state.worker, unused);
            }

            emit RewardPaid(taskId, state.worker, state.rewardUsd, currentPrice, effectivePrice, tokenReward);
        } else {
            // Path B — Bounty (no pre-reservation): pay each winner proportionally.
            // If oracle is unavailable, skip the token bonus; USDC payout is not blocked.
            if (!settlePrice.valid) return true;
            if (verdict.awards.length == 0) revert NoWorkerFound(taskId);

            for (uint256 i; i < verdict.awards.length; i++) {
                address worker = verdict.awards[i].worker;
                // Use per-winner pre-fee USDC amount as the USD basis for token reward.
                uint256 workerUsd = verdict.awards[i].amount;
                uint256 rawReward = FullMath.mulDiv(workerUsd, priceScaler, settlePrice.price);
                uint256 budgetRemaining = epochBudget.remaining(ctx.requester, worker);
                uint256 vaultAvail = vault.available();
                uint256 taskCap = epochBudget.maxTokensPerTask();

                uint256 tokenReward = _min4(rawReward, budgetRemaining, vaultAvail, taskCap);
                if (tokenReward == 0) continue; // vault empty or budget exhausted; skip for this worker

                // TOCTOU guard: remaining() was read above but the budget may have been
                // exhausted by a concurrent call before checkAndConsume runs. Wrap in
                // try-catch so an unexpected revert silently skips the token reward
                // instead of reverting checkComplete and blocking the USDC payout.
                try epochBudget.checkAndConsume(ctx.requester, worker, tokenReward) {
                // consume succeeded — vault payment follows below
                }
                catch {
                    tokenReward = 0;
                }
                if (tokenReward == 0) continue;
                bool tokenPaid = false;
                try vault.payDirect(worker, tokenReward) {
                    tokenPaid = true;
                } catch { }
                if (tokenPaid) {
                    emit RewardPaid(taskId, worker, workerUsd, settlePrice.price, settlePrice.price, tokenReward);
                } else {
                    try epochBudget.release(ctx.requester, worker, tokenReward) { } catch { }
                }
            }
        }

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ITMPHook — on hooks (try-catch wrapped by Diamond, must not revert)
    // ─────────────────────────────────────────────────────────────────────────

    function onComplete(
        bytes32 taskId,
        ITMPCore.TaskContext calldata,
        /* ctx */
        ITMPCore.Verdict calldata /* verdict */
    )
        external
        override
        onlyDiamond
    {
        // Payment was already handled in checkComplete. Defensive: if somehow
        // reserved but not paid, release the reserve.
        RewardState storage state = rewardStates[taskId];
        if (state.reserved && !state.paid && state.reservedTokenAmount > 0) {
            try vault.release(taskId, state.reservedTokenAmount) { } catch { }
            try epochBudget.release(state.requester, state.worker, state.reservedTokenAmount) { } catch { }
            emit RewardReserveReleased(taskId, state.reservedTokenAmount);
        }
    }

    function onForfeit(
        bytes32 taskId,
        ITMPCore.TaskContext calldata,
        /* ctx */
        address /* worker */
    )
        external
        override
        onlyDiamond
    {
        _releaseReserve(taskId);
    }

    function onCancel(
        bytes32 taskId,
        ITMPCore.TaskContext calldata /* ctx */
    )
        external
        override
        onlyDiamond
    {
        _releaseReserve(taskId);
    }

    function onExpire(
        bytes32 taskId,
        ITMPCore.TaskContext calldata /* ctx */
    )
        external
        override
        onlyDiamond
    {
        _releaseReserve(taskId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ERC-165
    // ─────────────────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(ITMPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Owner config
    // ─────────────────────────────────────────────────────────────────────────

    function setOracle(address _oracle) external onlyOwner {
        oracle = ITokenUsdOracle(_oracle);
    }

    function setVault(address _vault) external onlyOwner {
        vault = IRewardVault(_vault);
    }

    function setEpochBudget(address _epochBudget) external onlyOwner {
        epochBudget = EpochBudget(_epochBudget);
    }

    function setDiamond(address _diamond) external onlyOwner {
        diamond = _diamond;
    }

    function setDriftBandBps(uint16 _driftBandBps) external onlyOwner {
        if (_driftBandBps >= 10000) revert DriftBandBpsTooHigh();
        driftBandBps = _driftBandBps;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _reserveForWorker(bytes32 taskId, address requester, address worker) internal returns (bool) {
        RewardState storage state = rewardStates[taskId];

        PriceData memory price = oracle.getPrice();
        if (!price.valid) revert OracleInvalid();

        uint256 startPrice = price.price;
        uint256 minSettle = (startPrice * (10000 - driftBandBps)) / 10000;
        if (minSettle == 0) revert OraclePriceTooLow();
        uint256 maxSettle = (startPrice * (10000 + driftBandBps)) / 10000;

        // Worst case: price falls to minSettle — maximum token payout
        uint256 maxTokenReward = FullMath.mulDiv(state.rewardUsd, priceScaler, minSettle);

        state.startPrice = startPrice;
        state.minSettlePrice = minSettle;
        state.maxSettlePrice = maxSettle;
        state.worker = worker;
        state.reserved = true;

        // TOCTOU guard: budget may be exhausted between remaining() and checkAndConsume.
        // reservedTokenAmount stays 0 on failure so no token reward is owed without
        // blocking USDC payout. epochBudget is a trusted owner-set contract with no
        // callback mechanism, so the reentrancy-no-eth finding is a false positive.
        state.reservedTokenAmount = 0;
        // slither-disable-next-line reentrancy-no-eth
        try epochBudget.checkAndConsume(requester, worker, maxTokenReward) {
            state.reservedTokenAmount = maxTokenReward;
            vault.reserve(taskId, maxTokenReward);
        } catch { }

        emit RewardReserved(taskId, worker, startPrice, maxTokenReward);
        return true;
    }

    function _releaseReserve(bytes32 taskId) internal {
        RewardState storage state = rewardStates[taskId];
        if (!state.reserved || state.paid || state.reservedTokenAmount == 0) return;
        uint256 amount = state.reservedTokenAmount;
        // Clear state before external calls to prevent double-release on re-entry or
        // a second terminal dispatch emitting a phantom RewardReserveReleased event.
        state.reserved = false;
        state.reservedTokenAmount = 0;
        try vault.release(taskId, amount) { } catch { }
        try epochBudget.release(state.requester, state.worker, amount) { } catch { }
        emit RewardReserveReleased(taskId, amount);
    }

    function _clamp(uint256 value, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (value < lo) return lo;
        if (value > hi) return hi;
        return value;
    }

    function _min3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return a < b ? (a < c ? a : c) : (b < c ? b : c);
    }

    function _min4(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256) {
        uint256 ab = a < b ? a : b;
        uint256 cd = c < d ? c : d;
        return ab < cd ? ab : cd;
    }
}
