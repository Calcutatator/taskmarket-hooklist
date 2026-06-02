# ERC-8195 Multi-hop Task Delegation

## Problem

ERC-8195 models tasks as independent, flat escrow units. Each task has one requester, one
(or more) worker(s), and its own locked reward. The protocol has no concept of a relationship
between tasks.

This works for direct procurement but breaks when agents subcontract. If Agent A hires Agent B,
and B delegates part of the work to Agent C, the chain looks like two independent tasks:

- Task A-B: A is requester, B is worker
- Task B-C: B is requester, C is worker

These tasks have no on-chain relationship. Settlement does not propagate. B must manually call
`acceptSubmission` on Task A-B after C completes Task B-C. Between those two events, B is
exposed: A's task could expire, the relay could fail, or B could be under-capitalised and unable
to front C's reward at all. The settlement is a series of bilateral IOUs with no protocol-level
guarantee they clear.

This also means the trust relationship is invisible to the protocol. A trusted B to do the work.
If B subcontracts to C, A has no on-chain visibility into C's involvement, cannot rate C, and
has no recourse if C delivered junk that B accepted. The ERC-8004 reputation signal lands only
on B. Reputation and accountability do not propagate through the chain.

There is a hook mechanism (`ITMPHook.onComplete`) that fires after settlement, but it cannot
solve this. The `nonReentrant` guard blocks any re-entrant call back into the same TaskMarket
contract, so a hook on Task B-C cannot synchronously trigger `acceptSubmission` on Task A-B
within the same call. Off-chain relay works but reintroduces the trust problem the protocol was
meant to eliminate.

---

## Design Space

Two approaches exist, differing in how much structure the protocol enforces.

### Approach 1: Minimal (Linked Tree)

Add `bytes32 parentTaskId` (zero for root tasks) to `createTask`. The contract enforces:

- The caller must be the current worker on the parent task.
- The child reward must not exceed the parent's remaining available balance.
- Child rewards are funded by splitting from the parent's locked escrow, not from the worker's
  wallet. C gets paid directly from A's original deposit when the child is accepted.

The parent tracks `uint256 pendingChildCount`. It cannot reach `Accepted` until all children
are in a terminal state (`Accepted`, `Expired`, or `Cancelled`). If a child expires, its
reserved portion refunds back into the parent's available balance.

State machine additions:

```
Open
  --[claimTask / selectWorker]--> WorkerSelected
  --[createChildTask*]----------> Delegating

Delegating
  --[childAccepted]-------------> Delegating        (more children pending)
  --[lastChildAccepted]---------> PendingApproval
  --[expire]--------------------> Expired
```

This eliminates capital exposure at every hop. No agent in the middle needs to front rewards.
Settlement flows atomically from A's escrow to C without B touching the funds.

Reputation attribution is straightforward: the root requester rates the root worker (B). If B
created child tasks, the protocol knows which agent IDs worked each child and can emit
`TaskRated` events for each, letting the ERC-8004 Reputation Registry record contribution at
every level.

**Trade-offs:**

- Simple to reason about. Trees are acyclic; no dependency cycle risk.
- `refundExpired` remains straightforward: parent cannot expire while children are live because
  child creation extends `task.expiryTime` by the child's duration (matching the evaluator
  extension pattern in Part VII of the spec).
- Depth should be bounded (suggested limit: 8 hops) to keep gas predictable and prevent
  pathological nesting.
- Cannot express parallel branches that fan out from a single node and re-merge (no join
  semantics).

### Approach 2: Maximal (Durable Workflow DAG)

Replace the single `parentTaskId` with `bytes32[] dependencyTaskIds`. A task with multiple
dependencies is a join node: it transitions from `Blocked` to `Open` only when all dependencies
reach `Accepted`. Fork/join patterns become expressible on-chain.

This turns ERC-8195 into a workflow execution protocol. The analogy is Temporal (durable
execution engine) rather than Prefect (DAG scheduler):

- **Temporal** guarantees a workflow runs to completion across failures by replaying an
  authoritative event log. The on-chain task DAG serves the same role: it is the durable,
  tamper-evident record of what has happened, enabling the system to resume correctly after any
  relay failure, process crash, or expired subtask.
- **Prefect** handles scheduling and dependency resolution for data pipelines, but does not
  provide the fault-tolerance guarantees that trustless multi-agent settlement requires. It is
  useful as a mental model for the DAG shape, not for the execution guarantees.

A `TaskScheduler` facet watches dependency state and transitions nodes automatically. When all
dependencies for a node reach terminal state, the scheduler calls an internal `_unblock(taskId)`
that transitions it from `Blocked` to `Open` without requiring an external transaction.

Additional state machine nodes:

```
Blocked      -- one or more dependencies not yet Accepted
Open         -- dependencies cleared, accepting workers  
Delegating   -- worker has created children
Merging      -- all children terminal, aggregating results upward
Accepted
```

Cross-contract settlement becomes necessary here. If B's submarket is a different ERC-8195
deployment than A's (specialist agent marketplaces are likely heterogeneous), the settlement
chain crosses contract boundaries. A `SettlementRelay` coordinator holds cross-contract
obligations and settles them via a two-phase pattern: reserve on source contract, confirm on
destination contract, release only when both sides commit.

Reward distribution in the maximal form is post-hoc: the root requester rates the root task,
and a share of that rating event propagates down the DAG proportional to each node's contribution
weight (set at child creation time). This requires a `giveFeedbackBatch` call on the ERC-8004
Reputation Registry that the current spec does not define.

**Trade-offs:**

- Full expressiveness: parallel subtask branches, conditional paths, multi-market orchestration.
- The `refundExpired` invariant (Part VII) becomes recursive. A parent cannot expire until its
  children resolve, but children may be on different contracts with different clocks. The
  fund recovery guarantee requires a cross-contract coordination protocol, not just a local
  timestamp check.
- On-chain scheduling is expensive. Every dependency edge is a storage write. Every `_unblock`
  call is an on-chain state transition. Deep graphs with many parallel branches can become
  cost-prohibitive.
- Realistic implementation: DAG structure on-chain for trustless settlement guarantees; an
  authorized off-chain sequencer calls `resolveNode(taskId)` when dependencies clear. The
  on-chain graph is the source of truth for who gets paid and when; the sequencer is a
  liveness concern, not a safety concern.

---

## Interface Sketch (Minimal Form)

```solidity
// Addition to createTask parameters
function createTask(
    address  requester,
    uint256  reward,
    uint256  duration,
    bytes4   mode,
    uint256  pitchDeadline,
    uint256  bidDeadline,
    bytes32  parentTaskId   // zero for root tasks
) external returns (bytes32 taskId);

// New event
event ChildTaskCreated(
    bytes32 indexed parentTaskId,
    bytes32 indexed childTaskId,
    address indexed worker,
    uint256         reservedReward
);

// New event
event ChildTaskSettled(
    bytes32 indexed parentTaskId,
    bytes32 indexed childTaskId,
    bool            accepted,
    uint256         releasedReward
);
```

The `ITMPHook` interface would need two additions:

```solidity
function checkCreateChildTask(
    bytes32 parentTaskId,
    bytes32 childTaskId,
    ITMPCore.TaskContext calldata ctx,
    uint256 reservedReward
) external returns (bool);

function onChildTaskSettled(
    bytes32 parentTaskId,
    bytes32 childTaskId,
    ITMPCore.TaskContext calldata ctx,
    bool accepted
) external;
```

---

## Open Questions

1. **Depth limit.** Should the protocol enforce a maximum chain depth on-chain, or leave it to
   implementations? On-chain enforcement prevents gas exhaustion attacks; off-chain policy is
   more flexible.

2. **Fee model.** Does the platform fee apply at every hop or only at the root? Per-hop fees
   compound quickly in deep chains and may make delegation economically unviable.

3. **Partial acceptance.** Can a parent accept a subset of children and release partial reward
   while other children are still running? Useful for long pipelines but complicates the state
   machine.

4. **Worker authority to sub-delegate.** Should the root requester be able to restrict whether
   their task can be sub-delegated? A `delegationPolicy` flag on `createTask` (none / one-hop /
   unbounded) would let requesters opt out of chains they did not anticipate.

5. **Cross-contract children (maximal only).** What authority does the parent contract have to
   verify that a child task on a foreign ERC-8195 contract actually completed? ERC-165 interface
   detection confirms compliance but not honest behavior. An oracle or staking bond on the child
   contract may be required.
