// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AppStorage } from "./LibAppStorage.sol";
import { ITMPCore } from "../interfaces/ITMPCore.sol";
import { ITMPEvaluator } from "../interfaces/ITMPEvaluator.sol";
import { ITMPHook } from "../interfaces/ITMPHook.sol";
import { IPGTRForwarder } from "../interfaces/IPGTRForwarder.sol";

/// @title LibTaskMarket — shared internal helpers for TaskMarket facets
/// @dev All helpers take AppStorage as an explicit parameter so they can be called
///      from any facet. Functions that call external contracts must be `internal`
///      (not `private`) so they are accessible across facets via library linkage.
library LibTaskMarket {
    uint256 internal constant NOT_ENTERED = 1;
    uint256 internal constant ENTERED = 2;

    // -------------------------------------------------------------------------
    // Errors (not in ITMPCore since they are implementation-specific)
    // -------------------------------------------------------------------------

    /// @notice Revert when a function is called while the contract is paused.
    error EnforcedPause();

    /// @notice Revert on reentrancy attempt.
    error ReentrancyGuardReentrantCall();

    // -------------------------------------------------------------------------
    // Guards
    // -------------------------------------------------------------------------

    function _requireForwarder(AppStorage storage s) internal view {
        if (!s.trustedForwarders[msg.sender]) revert ITMPCore.NotTrustedForwarder();
    }

    function _requireNotPaused(AppStorage storage s) internal view {
        if (s.paused) revert EnforcedPause();
    }

    function _nonReentrantBefore(AppStorage storage s) internal {
        if (s.reentrancyStatus == ENTERED) revert ReentrancyGuardReentrantCall();
        s.reentrancyStatus = ENTERED;
    }

    function _nonReentrantAfter(AppStorage storage s) internal {
        s.reentrancyStatus = NOT_ENTERED;
    }

    // -------------------------------------------------------------------------
    // PGTR forwarder resolution
    // -------------------------------------------------------------------------

    /// @notice Returns the authenticated actor for this call.
    ///         If msg.sender is a trusted PGTR forwarder, returns pgtrSender().
    ///         Otherwise returns msg.sender.
    function _effectiveSender(AppStorage storage s) internal view returns (address) {
        if (s.trustedForwarders[msg.sender]) {
            return IPGTRForwarder(msg.sender).pgtrSender();
        }
        return msg.sender;
    }

    // -------------------------------------------------------------------------
    // Hook helpers — low-level
    // -------------------------------------------------------------------------

    /// @notice Builds a TaskContext snapshot for hook callbacks.
    function _buildContext(bytes32 taskId, AppStorage storage s) internal view returns (ITMPCore.TaskContext memory) {
        ITMPCore.Task storage t = s.tasks[taskId];
        ITMPCore.TaskEvaluatorConfig storage ec = s.taskEvaluatorConfigs[taskId];
        return ITMPCore.TaskContext({
            taskId: taskId,
            requester: t.requester,
            evaluator: ec.evaluator,
            paymentToken: address(s.usdcToken),
            reward: t.reward,
            evaluatorStake: ec.evaluatorStake,
            evaluatorFeeBps: ec.evaluatorFeeBps,
            submissionDeadline: t.expiryTime,
            evaluationWindow: ec.evaluationWindow,
            appealWindow: ec.appealWindow,
            disputeResolver: ec.disputeResolver,
            currentState: t.status,
            mode: t.mode,
            tags: s.taskTags[taskId]
        });
    }

    /// @notice Returns the hook list for a task (Rev008).
    ///         task.hookContract is deprecated dead storage; taskHooks is authoritative.
    function _resolveHooks(bytes32 taskId, AppStorage storage s) internal view returns (address[] memory) {
        return s.taskHooks[taskId];
    }

    /// @notice Calls check* on every hook in order. Reverts with errSelector if any hook rejects.
    function _dispatchCheckHooks(address[] memory hooks, bytes memory callData, bytes4 errSelector) internal {
        for (uint256 i; i < hooks.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok, bytes memory ret) = hooks[i].call(callData);
            if (!ok || ret.length < 32 || !abi.decode(ret, (bool))) {
                assembly {
                    mstore(0x00, errSelector)
                    revert(0x00, 0x04)
                }
            }
        }
    }

    /// @notice Calls on* on every hook in order. Failures are swallowed individually.
    function _dispatchAfterHooks(address[] memory hooks, bytes memory callData) internal {
        for (uint256 i; i < hooks.length; i++) {
            // slither-disable-next-line unchecked-lowlevel
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok,) = hooks[i].call(callData);
            if (!ok) emit ITMPCore.HookCallFailed(hooks[i]);
        }
    }

    // -------------------------------------------------------------------------
    // Evaluator configuration — shared by the two entry points that may write it
    // -------------------------------------------------------------------------

    /// @notice Writes a task's evaluator configuration and pulls any evaluator stake.
    /// @dev Two entry points may configure an evaluator: CoreFacet.createTask, which takes the
    ///      configuration atomically with the task itself, and EvaluatorFacet.assignEvaluator,
    ///      which appoints one to an already-live task. They share this body deliberately. If
    ///      each kept its own copy, the creation path would sooner or later validate less than
    ///      the assignment path and become the way to bypass the difference — the guard that is
    ///      cheapest to skip is the one nobody has written yet.
    ///
    ///      Only the checks that are the same on both paths live here. The checks that depend on
    ///      the caller's own context stay with the caller, because they genuinely differ: on
    ///      creation the requester is the authenticated sender by construction and the task is
    ///      Open by construction, so `NotRequester` and `TaskNotOpen` have nothing to test.
    /// @param taskId    Task identifier
    /// @param requester Authenticated requester; the address any stake is pulled from
    /// @param cfg       Evaluator terms to store
    /// @param s         AppStorage
    function _applyEvaluatorConfig(
        bytes32 taskId,
        address requester,
        ITMPCore.TaskEvaluatorConfig memory cfg,
        AppStorage storage s
    ) internal {
        ITMPCore.TaskEvaluatorConfig storage evalCfg = s.taskEvaluatorConfigs[taskId];
        if (cfg.evaluator == address(0)) revert ITMPCore.InvalidEvaluator();
        if (evalCfg.evaluator != address(0)) revert ITMPCore.EvaluatorAlreadyAssigned();
        if (cfg.evaluatorFeeBps > 10000) revert ITMPCore.FeeBpsTooHigh();

        evalCfg.evaluator = cfg.evaluator;
        evalCfg.evaluatorStake = cfg.evaluatorStake;
        evalCfg.evaluatorFeeBps = cfg.evaluatorFeeBps;
        evalCfg.evaluationWindow = cfg.evaluationWindow;
        evalCfg.appealWindow = cfg.appealWindow;
        evalCfg.disputeResolver = cfg.disputeResolver;

        if (cfg.evaluatorStake > 0) {
            // Pull stake from the requester. Pulling from an arbitrary evaluator address would
            // let a malicious requester drain any address that has pre-approved this contract.
            // requester = _effectiveSender(s) = authenticated PGTR forwarder caller; not arbitrary
            // slither-disable-next-line arbitrary-send-erc20
            if (!s.usdcToken.transferFrom(requester, address(this), cfg.evaluatorStake)) {
                revert ITMPCore.StakeTransferFailed();
            }
        }

        // Emitted identically whichever entry point wrote the config, so an indexer sees one
        // event vocabulary for "this task has an evaluator" rather than having to infer it from
        // TaskCreated on the creation path.
        emit ITMPEvaluator.EvaluatorAssigned(taskId, cfg.evaluator, cfg.evaluatorStake);
    }

    // -------------------------------------------------------------------------
    // Hook helpers — typed dispatch (keep abi.encodeCall out of facet stack frames)
    // -------------------------------------------------------------------------

    /// @notice Calls checkFund on all hooks, reverts if any reject. Emits HookRegistered per hook.
    function _checkFundHooks(bytes32 taskId, address[] memory hooks, bytes calldata hookData, AppStorage storage s)
        internal
    {
        bytes memory callData = abi.encodeCall(ITMPHook.checkFund, (taskId, _buildContext(taskId, s), hookData));
        for (uint256 i; i < hooks.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok, bytes memory ret) = hooks[i].call(callData);
            if (!ok || ret.length < 32 || !abi.decode(ret, (bool))) {
                revert ITMPCore.HookCheckFundRejected();
            }
            emit ITMPCore.HookRegistered(taskId, hooks[i]);
        }
    }

    function _checkClaimHooks(bytes32 taskId, address worker, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        if (hooks.length == 0) return;
        _dispatchCheckHooks(
            hooks,
            abi.encodeCall(ITMPHook.checkClaim, (taskId, _buildContext(taskId, s), worker)),
            ITMPCore.HookCheckClaimRejected.selector
        );
    }

    function _checkSelectWorkerHooks(bytes32 taskId, address worker, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        if (hooks.length == 0) return;
        _dispatchCheckHooks(
            hooks,
            abi.encodeCall(ITMPHook.checkSelectWorker, (taskId, _buildContext(taskId, s), worker)),
            ITMPCore.HookCheckSelectWorkerRejected.selector
        );
    }

    function _checkSubmitHooks(bytes32 taskId, address worker, bytes32 deliverable, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        if (hooks.length == 0) return;
        _dispatchCheckHooks(
            hooks,
            abi.encodeCall(ITMPHook.checkSubmit, (taskId, _buildContext(taskId, s), worker, deliverable)),
            ITMPCore.HookCheckSubmitRejected.selector
        );
    }

    function _checkEvaluateHooks(bytes32 taskId, address evaluator, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        if (hooks.length == 0) return;
        _dispatchCheckHooks(
            hooks,
            abi.encodeCall(ITMPHook.checkEvaluate, (taskId, _buildContext(taskId, s), evaluator)),
            ITMPCore.HookCheckEvaluateRejected.selector
        );
    }

    function _checkCompleteHooks(bytes32 taskId, AppStorage storage s, ITMPCore.Verdict memory verdict) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        if (hooks.length == 0) return;
        _dispatchCheckHooks(
            hooks,
            abi.encodeCall(ITMPHook.checkComplete, (taskId, _buildContext(taskId, s), verdict)),
            ITMPCore.HookCheckCompleteRejected.selector
        );
    }

    function _onCompleteHooks(bytes32 taskId, AppStorage storage s, ITMPCore.Verdict memory verdict) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        _dispatchAfterHooks(hooks, abi.encodeCall(ITMPHook.onComplete, (taskId, _buildContext(taskId, s), verdict)));
    }

    function _onForfeitHooks(bytes32 taskId, address forfeiter, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        _dispatchAfterHooks(hooks, abi.encodeCall(ITMPHook.onForfeit, (taskId, _buildContext(taskId, s), forfeiter)));
    }

    function _onCancelHooks(bytes32 taskId, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        _dispatchAfterHooks(hooks, abi.encodeCall(ITMPHook.onCancel, (taskId, _buildContext(taskId, s))));
    }

    function _onExpireHooks(bytes32 taskId, AppStorage storage s) internal {
        address[] memory hooks = _resolveHooks(taskId, s);
        _dispatchAfterHooks(hooks, abi.encodeCall(ITMPHook.onExpire, (taskId, _buildContext(taskId, s))));
    }
}
