// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EpochBudget
/// @notice Tracks per-epoch token emission caps: global, per-worker, and per-requester.
///         Only the authorised hook contract may call mutating functions.
///
///         Usage is tracked against a monotonic epoch index. When the epoch rolls,
///         all usage is considered reset without O(n) clears: each account's stored
///         (epoch, used) pair is treated as zero usage when its epoch != the current one.
contract EpochBudget is Ownable {
    struct Usage {
        uint64 epoch;
        uint192 used;
    }

    address public hook;

    uint256 public epochDuration;
    uint256 public globalCap;
    uint256 public workerCap;
    uint256 public requesterCap;
    uint256 public maxTokensPerTask;

    uint64 public currentEpoch;
    uint256 public epochStart;

    Usage internal globalUsage;
    mapping(address => Usage) internal workerUsage;
    mapping(address => Usage) internal requesterUsage;

    event HookSet(address indexed hook);
    event EpochRolled(uint64 indexed newEpoch, uint256 startTime);
    event Consumed(address indexed requester, address indexed worker, uint256 amount);
    event Released(address indexed requester, address indexed worker, uint256 amount);

    error OnlyHook();
    error EpochDurationZero();
    error CapExceedsUint192();
    error GlobalCapExceeded(uint256 requested, uint256 remaining);
    error WorkerCapExceeded(address worker, uint256 requested, uint256 remaining);
    error RequesterCapExceeded(address requester, uint256 requested, uint256 remaining);
    error TaskCapExceeded(uint256 requested, uint256 cap);

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    constructor(
        uint256 _epochDuration,
        uint256 _globalCap,
        uint256 _workerCap,
        uint256 _requesterCap,
        uint256 _maxTokensPerTask,
        address _owner
    ) Ownable(_owner) {
        if (_epochDuration == 0) revert EpochDurationZero();
        if (_globalCap > type(uint192).max) revert CapExceedsUint192();
        if (_workerCap > type(uint192).max) revert CapExceedsUint192();
        if (_requesterCap > type(uint192).max) revert CapExceedsUint192();
        epochDuration = _epochDuration;
        globalCap = _globalCap;
        workerCap = _workerCap;
        requesterCap = _requesterCap;
        maxTokensPerTask = _maxTokensPerTask;
        epochStart = block.timestamp;
        currentEpoch = 1;
    }

    function setHook(address _hook) external onlyOwner {
        hook = _hook;
        emit HookSet(_hook);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Effective epoch as of `block.timestamp` (does not mutate state).
    function _effectiveEpoch() internal view returns (uint64) {
        if (block.timestamp >= epochStart + epochDuration) {
            // How many full epochs have elapsed since epochStart
            uint256 elapsed = (block.timestamp - epochStart) / epochDuration;
            return uint64(currentEpoch + elapsed);
        }
        return currentEpoch;
    }

    function _usedIn(Usage storage u, uint64 epoch) internal view returns (uint256) {
        // slither-disable-next-line incorrect-equality
        return u.epoch == epoch ? uint256(u.used) : 0;
    }

    function globalUsed() external view returns (uint256) {
        return _usedIn(globalUsage, _effectiveEpoch());
    }

    function workerUsed(address worker) external view returns (uint256) {
        return _usedIn(workerUsage[worker], _effectiveEpoch());
    }

    function requesterUsed(address requester) external view returns (uint256) {
        return _usedIn(requesterUsage[requester], _effectiveEpoch());
    }

    /// @notice Remaining capacity for a requester/worker pair in the effective epoch.
    function remaining(address requester, address worker) external view returns (uint256) {
        uint64 epoch = _effectiveEpoch();
        uint256 globalRem = globalCap - _min(globalCap, _usedIn(globalUsage, epoch));
        uint256 workerRem = workerCap - _min(workerCap, _usedIn(workerUsage[worker], epoch));
        uint256 reqRem = requesterCap - _min(requesterCap, _usedIn(requesterUsage[requester], epoch));
        return _min(_min3(globalRem, workerRem, reqRem), maxTokensPerTask);
    }

    // ─── Mutations ────────────────────────────────────────────────────────────

    function _rollEpochIfStale() internal returns (uint64) {
        if (block.timestamp >= epochStart + epochDuration) {
            // slither-disable-next-line divide-before-multiply
            uint256 elapsed = (block.timestamp - epochStart) / epochDuration;
            currentEpoch = uint64(currentEpoch + elapsed);
            epochStart = epochStart + elapsed * epochDuration;
            emit EpochRolled(currentEpoch, epochStart);
        }
        return currentEpoch;
    }

    /// @notice Check capacity and consume budget. Reverts if any cap is exceeded.
    function checkAndConsume(address requester, address worker, uint256 amount) external onlyHook {
        uint64 epoch = _rollEpochIfStale();

        if (amount > maxTokensPerTask) revert TaskCapExceeded(amount, maxTokensPerTask);

        uint256 gUsed = _usedIn(globalUsage, epoch);
        uint256 globalRem = globalCap - _min(globalCap, gUsed);
        if (amount > globalRem) revert GlobalCapExceeded(amount, globalRem);

        uint256 wUsed = _usedIn(workerUsage[worker], epoch);
        uint256 workerRem = workerCap - _min(workerCap, wUsed);
        if (amount > workerRem) revert WorkerCapExceeded(worker, amount, workerRem);

        uint256 rUsed = _usedIn(requesterUsage[requester], epoch);
        uint256 reqRem = requesterCap - _min(requesterCap, rUsed);
        if (amount > reqRem) revert RequesterCapExceeded(requester, amount, reqRem);

        globalUsage = Usage(epoch, uint192(gUsed + amount));
        workerUsage[worker] = Usage(epoch, uint192(wUsed + amount));
        requesterUsage[requester] = Usage(epoch, uint192(rUsed + amount));
        emit Consumed(requester, worker, amount);
    }

    /// @notice Reverse previously consumed budget within the same epoch (cancel/expire/forfeit).
    ///         If the epoch has rolled since consumption, usage is already zero — no-op.
    function release(address requester, address worker, uint256 amount) external onlyHook {
        uint64 epoch = _rollEpochIfStale();
        bool anyDecremented = false;

        uint256 gUsed = _usedIn(globalUsage, epoch);
        if (gUsed >= amount) {
            globalUsage = Usage(epoch, uint192(gUsed - amount));
            anyDecremented = true;
        }

        uint256 wUsed = _usedIn(workerUsage[worker], epoch);
        if (wUsed >= amount) {
            workerUsage[worker] = Usage(epoch, uint192(wUsed - amount));
            anyDecremented = true;
        }

        uint256 rUsed = _usedIn(requesterUsage[requester], epoch);
        if (rUsed >= amount) {
            requesterUsage[requester] = Usage(epoch, uint192(rUsed - amount));
            anyDecremented = true;
        }

        if (anyDecremented) emit Released(requester, worker, amount);
    }

    // ─── Owner config ─────────────────────────────────────────────────────────

    function setGlobalCap(uint256 _globalCap) external onlyOwner {
        if (_globalCap > type(uint192).max) revert CapExceedsUint192();
        globalCap = _globalCap;
    }

    function setWorkerCap(uint256 _workerCap) external onlyOwner {
        if (_workerCap > type(uint192).max) revert CapExceedsUint192();
        workerCap = _workerCap;
    }

    function setRequesterCap(uint256 _requesterCap) external onlyOwner {
        if (_requesterCap > type(uint192).max) revert CapExceedsUint192();
        requesterCap = _requesterCap;
    }

    function setMaxTokensPerTask(uint256 _maxTokensPerTask) external onlyOwner {
        maxTokensPerTask = _maxTokensPerTask;
    }

    function setEpochDuration(uint256 _epochDuration) external onlyOwner {
        if (_epochDuration == 0) revert EpochDurationZero();
        epochDuration = _epochDuration;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _min3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return a < b ? (a < c ? a : c) : (b < c ? b : c);
    }
}
