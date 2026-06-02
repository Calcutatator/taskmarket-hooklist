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

## Approaches

Three approaches exist across a spectrum. The two problems they address are separable:
scheduling (unblocking downstream tasks as upstream complete) and attribution (proving who
delegated what to whom, tamper-evidently). Not every approach solves both.

| | On-chain Workflow | Hybrid Workflow | Off-chain Workflow |
|---|---|---|---|
| Settlement guarantees | Trustless, atomic | Atomic (requester signs batch) | Backend-enforced, bypassable |
| Protocol changes | Yes (new facet, state machine) | None | None |
| Capital exposure | Eliminated (escrow splitting) | Eliminated | Remains |
| Attribution tamper-proof | Yes | Yes | No |
| Cross-market support | Via SettlementRelay | No | No |
| Iteration speed | Slow (contract upgrades) | Fast | Fast |
| Right for | Adversarial environments, heterogeneous markets | Trusted ecosystems needing atomic settlement | Early-stage, low-stakes delegation |

---

## Approach 1: On-chain Workflow

### Minimal Form (Linked Tree)

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

### Maximal Form (Durable Workflow DAG)

Replace the single `parentTaskId` with `bytes32[] dependencyTaskIds`. A task with multiple
dependencies is a join node: it transitions from `Blocked` to `Open` only when all dependencies
reach `Accepted`. Fork/join patterns become expressible on-chain.

The analogy is Temporal (durable execution engine): Temporal guarantees a workflow runs to
completion across failures by replaying an authoritative event log. The on-chain task DAG serves
the same role — a durable, tamper-evident record of what has happened, enabling the system to
resume correctly after any relay failure, process crash, or expired subtask. This is the right
frame because "workflow" in this context means execution guarantees, not just scheduling, which
is what distinguishes it from lighter-weight DAG schedulers like Prefect or Airflow.

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

### Interface Sketch (Minimal Form)

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

## Approach 2: Hybrid Workflow

The hybrid approach separates the two problems. Scheduling stays off-chain (the backend
unblocks downstream tasks as upstream complete). Attribution goes on-chain via a standalone
`WorkflowRegistry` contract — not a facet, not an ERC-8195 protocol change, just an
independent registry that records delegation relationships.

### ITMPWorkflow Extension Interface

The `WorkflowRegistry` is defined as an optional extension interface to ERC-8195, following
the same pattern as `ITMPEvaluator`, `ITMPFees`, and `ITMPReputation`. Implementations declare
support via ERC-165; agents and aggregators detect it and know the contract natively understands
workflow relationships.

Living inside the Diamond alongside the other facets gives the workflow graph direct access to
live task state. `addTask` can enforce "caller must be current worker on parentTaskId" against
local storage without an external call. Workflow relationships are surfaced in the standard ABI
alongside tasks — consumers do not need to know a separate registry address.

```solidity
interface ITMPWorkflow is IERC165 {
    event WorkflowCreated(
        bytes32 indexed workflowId,
        bytes32 indexed rootTaskId,
        address         creator
    );

    event TaskLinked(
        bytes32 indexed workflowId,
        bytes32 indexed taskId,
        bytes32 indexed parentTaskId,
        address         worker
    );

    event WorkflowSettled(
        bytes32 indexed workflowId,
        address         requester,
        uint256         totalPaid
    );

    // Create a workflow rooted at an existing task. Caller must be the requester on rootTaskId.
    function createWorkflow(bytes32 rootTaskId) external returns (bytes32 workflowId);

    // Link a task into the workflow as a child of parentTaskId.
    // Caller must be the current worker on parentTaskId.
    function addWorkflowTask(bytes32 workflowId, bytes32 taskId, bytes32 parentTaskId) external;

    // Requester signs the final distribution; contract calls acceptSubmission on each task
    // and distributes from the root escrow atomically.
    function settleWorkflow(
        bytes32          workflowId,
        address[] calldata workers,
        uint256[] calldata amounts,
        bytes32[] calldata deliverables,
        bytes     calldata requesterSig
    ) external;

    function getWorkflow(bytes32 workflowId) external view returns (
        bytes32 rootTaskId,
        address creator,
        uint256 taskCount,
        bool    settled
    );

    function getWorkflowTask(bytes32 workflowId, bytes32 taskId) external view returns (
        bytes32 parentTaskId,
        address worker,
        uint256 depth
    );
}
```

No escrow splitting, no state machine extensions, no re-entrancy concerns. The backend reads
`TaskLinked` events as its source of truth for the DAG shape. If the backend is replaced or
goes down, the graph is fully reconstructable from chain history.

### Attribution Without Co-signing

Workers do not sign the settlement. They consented to their terms when they accepted their
individual tasks — that consent is already recorded on-chain. Only the root requester signs
the final distribution manifest (EIP-712), which is the same party who would call
`acceptSubmission` in the non-workflow case. The signature authorizes the `WorkflowRegistry`
to act as their agent for that single batch settlement call.

Requiring all parties to co-sign would impose a coordination problem that worsens with chain
depth. In automated agent pipelines, no agent is reliably "online" at settlement time, and
chasing signatures across multiple agents before payout can execute is worse than the manual
per-task approach it replaces.

### Atomic Settlement Without Escrow Splitting

`settleWorkflow` executes all `acceptSubmission` calls atomically in a single transaction.
If any call reverts (expired task, wrong deliverable), the whole settlement reverts. Workers
are paid directly from the root task's escrow — but B still fronts C's reward during
execution. The atomic guarantee is at settlement time, not during the workflow run.

This is the remaining gap vs the full on-chain approach: capital exposure during execution
persists. For short-duration workflows or reputation-staked workers this is acceptable. For
long-running workflows where B cannot afford to front C's reward for days, the on-chain
approach with escrow splitting is required.

### What This Gives an Agent

`task get <taskId>` returns task detail plus:

```json
{
  "workflow": {
    "id": "0x...",
    "registryAddress": "0x...",
    "depth": 2,
    "totalTasks": 5,
    "completedTasks": 3,
    "parentTaskId": "0x..."
  }
}
```

Any third party can verify the delegation chain by reading `WorkflowRegistry` events. The
backend is not the authority — the chain is.

---

## Approach 3: Off-chain Workflow

The on-chain approach provides trustless settlement but requires protocol changes, contract
upgrades, and accepts the gas cost of on-chain scheduling. For environments where workers are
known and reputation-staked, those guarantees may not be worth the cost. The off-chain workflow
solves the visibility and coordination problems without touching the protocol.

**Name: Workflows.**

A workflow is a named DAG of tasks managed by the backend. Settlement still happens task-by-task
on-chain. The backend tracks the graph, resolves dependencies, and surfaces the full workflow to
all participants. The name aligns with the Temporal frame: agents familiar with workflow engines
understand immediately what this means — a graph of steps that execute in dependency order, with
the system tracking progress and unblocking downstream steps automatically.

### Data Model

```sql
CREATE TABLE workflows (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by      bigint REFERENCES agents(id),
    root_task_id    text NOT NULL,
    title           text,
    status          text NOT NULL DEFAULT 'active',
                    -- active | completed | failed | cancelled
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);

CREATE TABLE workflow_tasks (
    workflow_id     uuid REFERENCES workflows(id),
    task_id         text NOT NULL,
    parent_task_id  text,               -- null for root node
    agent_id        bigint REFERENCES agents(id),
    depth           int NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'blocked',
                    -- blocked | open | in_progress | completed | failed
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workflow_id, task_id)
);
```

Tasks gain optional `workflow_id` and `parent_task_id` columns. No on-chain state.

### Backend Logic

When a task reaches `Accepted` (backend receives `TaskCompleted` from the contract event
listener), the workflow service:

1. Marks that node `completed` in `workflow_tasks`.
2. Queries for downstream nodes whose `parent_task_id` equals the completed task and whose
   other dependencies (if any) are all `completed`.
3. Transitions those nodes from `blocked` to `open`.
4. If all nodes are terminal, marks the workflow `completed`.

### tRPC Router Surface

```typescript
// workflows.router.ts
workflows.create   // create a workflow, returns workflow_id
workflows.get      // full DAG with status of each node
workflows.list     // workflows by agent (as requester or worker in any node)
workflows.addTask  // attach an on-chain task to a workflow with optional parent
workflows.status   // aggregate: X/N tasks complete, current blockers
```

### What This Gives an Agent

`task get <taskId>` on a task that belongs to a workflow returns the task detail plus:

```json
{
  "workflow": {
    "id": "...",
    "depth": 2,
    "totalTasks": 5,
    "completedTasks": 3,
    "parentTaskId": "0x..."
  }
}
```

The agent knows whether it is part of a larger job, who commissioned the root, what is still
outstanding, and whether it is authorised to create child tasks.

### Constraint Enforcement (Off-chain)

The backend validates at `task create` time:

- Sum of child task rewards does not exceed the parent task's reward.
- Creating agent is the current worker on the parent task.
- Workflow depth does not exceed the configured limit (default: 8).

A malicious worker can bypass backend validation and create an overbudget child task directly
on-chain. For trusted, reputation-staked environments this is acceptable. For adversarial
environments, use the on-chain approach.

---

## Open Questions

1. **Fee model.** Does the platform fee apply at every hop or only at the root? Per-hop fees
   compound quickly in deep chains and may make delegation economically unviable.

2. **Partial acceptance.** Can a parent accept a subset of children and release partial reward
   while other children are still running?

3. **Worker authority to sub-delegate.** Should the root requester be able to restrict whether
   their task can be sub-delegated? A `delegationPolicy` flag on `createTask` (none / one-hop /
   unbounded) would let requesters opt out of chains they did not anticipate. Applies to both
   approaches.

4. **Cross-contract children (on-chain maximal only).** What authority does the parent contract
   have to verify that a child task on a foreign ERC-8195 contract actually completed? ERC-165
   interface detection confirms compliance but not honest behavior. An oracle or staking bond on
   the child contract may be required.

5. **Depth limit enforcement.** On-chain: gas exhaustion risk if not bounded. Off-chain: policy
   decision, configurable per deployment.
