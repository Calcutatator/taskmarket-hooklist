# 0001 — ERC-8195 Delegation Chains — Task Workflow Design Options

- **Status:** Draft
- **Date:** 2026-06-02
- **Author:** Beau
- **Supersedes / Superseded-by:** —

## Summary

**ERC-8195 has no concept of task workflows.** A task workflow is a set of tasks related by
delegation: a requester posts a root task, a worker decomposes that task into subtasks and
assigns them to other agents, who may further decompose their subtasks, and so on. The
completed subtasks collectively constitute completion of the root task — the requester cares
about the root task outcome, and the protocol should handle coordination and settlement of
everything underneath it.

Today, every task is an isolated escrow unit. The protocol has no way to represent that Task
B was created because of Task A, that Task C is a subtask of Task B, or that settling Task C
should contribute toward settling Task A. There is no task workflow primitive. This proposal
defines task workflows for ERC-8195 and presents three implementation approaches.

## Motivation

Without task workflows, a worker who wants to subcontract must create a second independent
task out of their own pocket. The two tasks — the one they were hired on and the one they
created — have no on-chain connection.

Consider Agent A hiring Agent B, and B subcontracting to Agent C:

- Task A-B: A is requester, B is worker, reward escrowed
- Task B-C: B is requester, B fronts C's reward from their own wallet

When C completes Task B-C, nothing happens to Task A-B. B must manually call
`acceptSubmission` on Task A-B in a separate transaction. If A's task has expired by then,
B loses the reward they fronted to C. If B lacked the capital to front C's reward at all,
the subcontract cannot happen.

There is also no visibility. A does not know C is involved. A cannot rate C. If C delivers
bad work that B accepts without checking, A has no recourse and C receives no negative
reputation signal. The ERC-8004 reputation record shows B as the sole worker regardless
of what actually happened.

The `ITMPHook.onComplete` callback cannot bridge this gap. The `nonReentrant` guard prevents
any re-entrant call into the same TaskMarket contract, so a hook on Task B-C cannot
synchronously trigger `acceptSubmission` on Task A-B within the same call. Off-chain relays
work mechanically but reintroduce exactly the trust problem the protocol exists to eliminate.

## Proposal

Three approaches exist for adding task workflow support. They differ in where the workflow
graph is stored and how settlement is enforced.

### Approaches (comparison)

| | On-chain Workflow | Hybrid Workflow | Off-chain Workflow |
|---|---|---|---|
| Workflow graph stored | On-chain (contract state) | On-chain (contract state) | Off-chain (database) |
| Settlement guarantees | Trustless, atomic | Atomic (requester signs batch) | Backend-enforced, bypassable |
| Protocol changes | Yes — new facet + state machine additions | Yes — new facet only (`ITMPWorkflow`) | None |
| Capital exposure during execution | Eliminated (escrow splitting) | Remains (worker fronts child rewards) | Remains |
| Attribution tamper-proof | Yes | Yes | No |
| Cross-market task workflows | Yes, via SettlementRelay | No | No |
| Iteration speed | Slow (contract upgrade required) | Fast | Fast |
| Right for | Adversarial environments, heterogeneous markets | Trusted ecosystems needing atomic settlement | Early-stage, low-stakes delegation |

### Approach 1: On-chain Task Workflows

This approach adds task workflow structure directly to the ERC-8195 core state machine.
Every task can optionally declare a parent task. The contract enforces the relationship,
splits the parent escrow into child escrows, and propagates settlement automatically.

#### Minimal Form: Linked Task Tree

Add `bytes32 parentTaskId` (zero for root tasks) to `createTask`. The contract enforces:

- The caller creating the child task must be the current worker on the parent task.
- The child task reward is funded by splitting from the parent task's locked escrow — not
  from the worker's wallet. When C is paid, the funds come directly from A's original deposit.
- The sum of all child task rewards must not exceed the parent task's available balance.

The parent task tracks `uint256 pendingChildCount`. It cannot reach `Accepted` until all
child tasks are in a terminal state (`Accepted`, `Expired`, or `Cancelled`). If a child task
expires, its reserved portion refunds back into the parent's available balance.

New task states for workflow tasks:

```
Open
  --[claimTask / selectWorker]--> WorkerSelected
  --[createChildTask*]----------> Delegating

Delegating
  --[childTaskAccepted]---------> Delegating        (more child tasks pending)
  --[lastChildTaskAccepted]-----> PendingApproval
  --[expire]--------------------> Expired
```

No worker in the chain fronts capital. Settlement flows from the root escrow down to every
leaf task worker atomically. The `refundExpired` invariant is maintained by extending
`task.expiryTime` on the parent task when a child task is created, matching the evaluator
extension pattern in Part VII of the ERC-8195 spec.

**Trade-offs:**

- Trees are acyclic — no dependency cycle risk, straightforward to reason about.
- Depth must be bounded (recommended: 8 hops) to keep gas costs predictable.
- Cannot express parallel branches that fan out and re-merge (no join semantics). For that,
  see the maximal form below.

#### Maximal Form: Full Task Workflow DAG

Replace the single `parentTaskId` with `bytes32[] dependencyTaskIds`. A task with multiple
dependencies becomes a join node: it transitions from `Blocked` to `Open` only when all
dependency tasks reach `Accepted`. Fork/join task workflow patterns become expressible
on-chain.

A `TaskScheduler` facet monitors dependency state. When all dependencies for a blocked task
resolve, the scheduler calls `_unblock(taskId)` internally, transitioning it from `Blocked`
to `Open` without requiring an external transaction.

The contract MUST reject invalid `dependencyTaskIds` at task creation time:

- **Self-links**: if `dependencyTaskIds` contains `taskId` itself, revert. A task cannot
  depend on itself.
- **Cycles**: before accepting the new task, the scheduler performs a depth-first reachability
  check from each dependency back through its own dependencies. If any path reaches `taskId`,
  revert with `DependencyCycle`. The depth bound (recommended: 8) caps the worst-case cost
  of this check to a constant number of storage reads.

Additional task workflow states:

```
Blocked      -- one or more dependency tasks not yet Accepted
Open         -- all dependencies cleared, accepting workers
Delegating   -- worker has created child tasks
Merging      -- all child tasks terminal, propagating results upward
Accepted
```

If a worker's submarket is a different ERC-8195 deployment (specialist agent markets are
likely heterogeneous), settlement crosses contract boundaries. A `SettlementRelay` coordinator
handles cross-contract task workflow settlement via a two-phase pattern: reserve on the source
contract, confirm on the destination, release when both sides commit.

**Trade-offs:**

- Full expressiveness: parallel task branches, conditional paths, cross-market task workflows.
- The `refundExpired` invariant becomes recursive across contracts with independent clocks.
  A cross-contract coordination protocol is required, not just a local timestamp check.
- On-chain scheduling is expensive. Every dependency edge is a storage write. Every `_unblock`
  call is an on-chain state transition. Deep task graphs with many parallel branches become
  cost-prohibitive.
- In practice: put the task workflow DAG on-chain for trustless settlement guarantees, but use
  an authorized off-chain sequencer to call `resolveNode(taskId)` when dependencies clear.
  The on-chain graph is the authority for who gets paid and when; the sequencer is a liveness
  concern, not a safety concern.

### Approach 2: Hybrid Task Workflows

This approach separates the two problems. Task workflow scheduling stays off-chain (the backend
unblocks downstream tasks as upstream tasks complete). Task workflow attribution goes on-chain
via a new `WorkflowFacet` implementing the `ITMPWorkflow` extension interface.

The key insight: you do not need on-chain escrow splitting to get tamper-evident attribution.
A standalone facet that records which tasks belong to which workflow, and which agent delegated
which subtask to which worker, gives you on-chain proof of the delegation graph without
touching the ERC-8195 core state machine.

This is the recommended approach for most production deployments. It requires a contract
upgrade (adding the `WorkflowFacet` via `diamondCut`) but no changes to the existing task
lifecycle. It provides on-chain attribution and atomic settlement, while leaving coordination
to the backend where it is cheaper and faster to iterate on.

#### ITMPWorkflow Extension Interface

`ITMPWorkflow` is an optional ERC-8195 extension, following the same pattern as
`ITMPEvaluator`, `ITMPFees`, and `ITMPReputation`. Implementations declare support via
ERC-165. The facet has direct access to live task state — `addWorkflowTask` enforces
"caller must be current worker on parentTaskId" against local `AppStorage` without an
external call.

```solidity
interface ITMPWorkflow is IERC165 {
    event WorkflowCreated(bytes32 indexed workflowId, bytes32 indexed rootTaskId, address creator);
    event TaskLinked(bytes32 indexed workflowId, bytes32 indexed taskId, bytes32 indexed parentTaskId, address worker, uint256 depth);
    event WorkflowSettled(bytes32 indexed workflowId, address requester, uint256 taskCount, uint256 totalPaid);

    // Create a task workflow rooted at an existing task. Caller must be the requester on rootTaskId.
    function createWorkflow(bytes32 rootTaskId) external returns (bytes32 workflowId);

    // Link a task into the workflow as a child of parentTaskId.
    // Caller must be the current worker on parentTaskId.
    function addWorkflowTask(bytes32 workflowId, bytes32 taskId, bytes32 parentTaskId) external;

    // Settle all tasks in the workflow atomically.
    // Only the root requester signs — workers consented when they accepted their individual tasks.
    function settleWorkflow(
        bytes32           workflowId,
        address[] calldata workers,
        uint256[] calldata amounts,
        bytes32[] calldata deliverables,
        bytes     calldata requesterSig
    ) external;

    function getWorkflow(bytes32 workflowId) external view returns (bytes32 rootTaskId, address creator, uint256 taskCount, bool settled);
    function getWorkflowTask(bytes32 workflowId, bytes32 taskId) external view returns (bytes32 parentTaskId, address worker, uint256 depth);
    function maxWorkflowDepth() external pure returns (uint256);
}
```

#### Settlement: Requester-Only Authorization

Only the root requester signs `settleWorkflow`. Workers do not co-sign. They consented to
their terms when they accepted their individual tasks — that consent is already recorded
on-chain. Requiring all workers to co-sign would create a coordination problem that worsens
with depth: in automated agent pipelines no agent is reliably online at settlement time, and
chasing signatures across an entire task workflow chain is worse than the manual per-task
`acceptSubmission` approach it replaces.

The requester signs an EIP-712 manifest specifying which worker gets which amount for which
deliverable. The contract verifies the signature and executes all `acceptSubmission` calls
in a single transaction. If any call reverts, the entire settlement reverts — full atomicity.

#### Remaining Gap vs On-chain Approach

Workers still front child task rewards during execution. `ITMPWorkflow` provides atomic
settlement at the end, not during the workflow run. If B cannot afford to front C's reward
for the duration of the workflow, the on-chain approach with escrow splitting is required.

### Approach 3: Off-chain Task Workflows

If trustless attribution is not required — for example, in a closed ecosystem of
reputation-staked agents where the backend operator is trusted — task workflows can be
implemented entirely in the backend database with no contract changes.

The backend tracks the task workflow graph in a `workflows` table. When a task in the
workflow reaches `Accepted` (detected via the `TaskCompleted` event), the workflow service
unblocks downstream tasks by marking them `open` in `workflow_tasks`. Settlement still
happens task-by-task on-chain; the workflow is purely a coordination layer.

A malicious worker can bypass backend validation and create an overbudget child task
directly on-chain, because nothing in the contract enforces workflow relationships.
For adversarial environments, use the hybrid or on-chain approach. For trusted environments
where speed of iteration matters more than trustless guarantees, off-chain task workflows
are a reasonable starting point.

#### Data Model

```sql
CREATE TABLE workflows (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by      bigint REFERENCES agents(id),
    root_task_id    text NOT NULL,
    title           text,
    status          text NOT NULL DEFAULT 'active',  -- active | completed | failed | cancelled
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);

CREATE TABLE workflow_tasks (
    workflow_id     uuid REFERENCES workflows(id),
    task_id         text NOT NULL,
    parent_task_id  text,
    agent_id        bigint REFERENCES agents(id),
    depth           int NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'blocked',  -- blocked | open | in_progress | completed | failed
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workflow_id, task_id),
    FOREIGN KEY (workflow_id, parent_task_id) REFERENCES workflow_tasks (workflow_id, task_id)
);
```

#### tRPC Router Surface

```typescript
// workflows.router.ts
workflows.create   // create a workflow, returns workflow_id
workflows.get      // full task DAG with status of each node
workflows.list     // workflows by agent (as requester or worker in any node)
workflows.addTask  // attach a task to a workflow with optional parent task
workflows.status   // aggregate: X/N tasks complete, current blockers
```

### Related Systems

The task workflow concepts in this proposal have analogues in existing workflow orchestration
software. Understanding the differences clarifies what ERC-8195 task workflows are and are not.

**Temporal** (temporal.io) is a durable execution engine. You write workflow code in a normal
programming language (Go, TypeScript, Python, Java) and Temporal guarantees it runs to
completion even if the process crashes or a step fails. It does this by replaying the entire
workflow execution history from a persistent event log — the log is the authoritative record
of what has happened. The on-chain task workflow DAG in Approach 1 (on-chain) serves the same
role: a tamper-evident, append-only record that allows the system to reconstruct state and
resume correctly after any failure. The key property shared with Temporal is durable execution
with an authoritative history.

**Prefect** (prefect.io) is a data pipeline orchestrator. You define tasks and flows in Python;
Prefect handles scheduling, dependency resolution, retries, and observability. The mental model
is a DAG of jobs that run in dependency order — closer to a scheduler than an execution engine.
The off-chain workflow approach (Approach 3) resembles Prefect: the backend is the scheduler,
it resolves dependencies and unblocks downstream tasks, but it does not provide the
fault-tolerance or tamper-evidence guarantees that Temporal does.

**The critical distinction for ERC-8195:** Temporal cares about *how* code executes —
durability, exactly-once semantics, surviving failures. Prefect cares about *what* runs and
in what order. For trustless multi-agent settlement, the Temporal property (authoritative
durable record) is what matters. Prefect's scheduling model is useful for thinking about DAG
shape but insufficient as a trust model. This is why the on-chain and hybrid approaches store
the workflow graph on-chain rather than purely in the backend — the chain is the Temporal-style
authoritative log.

## Open questions

1. **Fee model.** Does the platform fee apply at every task in the workflow or only at the
   root? Per-hop fees compound quickly in deep chains and may make task workflow delegation
   economically unviable.

2. **Partial settlement.** Can a requester settle a subset of workflow tasks and release
   partial reward while other tasks are still running?

3. **Delegation policy.** Should requesters be able to restrict whether their task can be
   sub-delegated into a workflow? A `delegationPolicy` flag on `createTask`
   (`none | one-hop | unbounded`) would let requesters opt out of task workflows they did
   not anticipate.

4. **Cross-market task workflows (on-chain maximal only).** What authority does the parent
   contract have to verify that a child task on a foreign ERC-8195 contract actually
   completed honestly? ERC-165 confirms interface compliance but not honest behavior.

5. **Depth limit.** On-chain: must be enforced in the contract to prevent gas exhaustion.
   Off-chain: configurable per deployment.

## Non-goals

This proposal does not select a single approach — it lays out three alternatives with
different trust/cost/speed trade-offs for later decision. It does not propose changes to
the ERC-8004 reputation record format, nor to the base ERC-8195 escrow/settlement primitives
outside of what each approach explicitly modifies. The off-chain approach (Approach 3)
explicitly does not attempt trustless attribution or tamper-proof settlement — those
properties are only in scope for the on-chain and hybrid approaches. The on-chain maximal
form explicitly does not resolve how a parent contract verifies *honest* completion of a
child task on a foreign ERC-8195 deployment (see Open Question 4) — it only defines the
interface-compliance and settlement-relay mechanics.

## References

- Spec: ERC-8195 core task lifecycle and evaluator extension pattern (Part VII)
- Related interfaces: `ITMPHook`, `ITMPEvaluator`, `ITMPFees`, `ITMPReputation` (existing
  ERC-8195 optional extensions, same pattern as the proposed `ITMPWorkflow`)
- Related standard: ERC-8004 (reputation record)
- External prior art: Temporal (temporal.io), Prefect (prefect.io) — see Related Systems
