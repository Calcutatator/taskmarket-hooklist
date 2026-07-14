# Task Drops Lean V1
## Product Requirements Document (PRD) + Technical Design Document (TDD)

Document owner: Product + Backend + Frontend  
Last updated: July 3, 2026  
Status: Proposed lean v1

## 1. Executive Summary

Task Drops are named groups of tasks that requesters create while publishing work. Workers subscribe to a specific drop and receive emails only when new tasks are published into that drop.

The current Task Drops implementation is not a real drop system. It is a global email list: every active subscriber receives every new task. Lean v1 replaces that with the smallest coherent product:
- a requester can publish a task with no drop
- a requester can publish a task into an existing owned drop
- a requester can create a new drop while publishing a task
- each drop has a public page where people can subscribe
- subscribers subscribe to a specific drop
- Task Drops email is sent only for tasks attached to that drop

Task Drops remain offchain in v1. There is no post-publish attach flow, no standalone drop management, no scheduling, and no multi-drop syndication. The goal is to prove the core product promise before adding lifecycle and operations complexity.

## 2. Product Promise

> Follow this drop and get notified when this requester publishes new tasks into it.

That is the only v1 promise.

Everything else is deferred unless required to keep this promise true.

## 3. Current Behavior

Today:
- `task_drop_subscriptions` stores global subscriptions.
- `taskDrops.subscribe` accepts email, optional wallet, and source.
- `taskDrops.status` checks global subscription state by email or wallet.
- `tasks.create` calls `notifyTaskDropSubscribers(...)` after every successful task insert.
- `notifyTaskDropSubscribers(...)` emails all active Task Drops subscribers.

This creates the wrong user expectation. A user who signs up for "drops" is subscribed to every task, not a specific work stream.

## 4. Goals and Non-Goals

### 4.1 Goals

1. Add a first-class drop record.
2. Let requesters choose a drop during task creation.
3. Let requesters create a drop inline during task creation.
4. Store the task-to-drop relationship on the task row.
5. Scope subscriptions to one drop.
6. Send Task Drops emails only to subscribers of the attached drop.
7. Add a public Task Drop page as the canonical subscription surface.
8. Remove or disable global Task Drops signup paths.
9. Keep existing task creation payment and contract behavior intact.
10. Keep the implementation small enough to ship and evaluate.

### 4.2 Non-Goals

1. Standalone drop create/edit/archive screens.
2. Post-publish attach, move, or detach.
3. Multiple drops per task.
4. Public drop directory.
5. Drop scheduling or batch release.
6. Notification outbox and retry worker.
7. CLI flags for drops.
8. Signed-wallet auth for free drop management.
9. Legacy global subscriber reactivation campaign.
10. Onchain drop state.

These can be added after v1 proves that users create, follow, and click through drops.

## 5. Core Concepts

### 5.1 Task Drop

A Task Drop is an offchain record owned by a requester wallet.

Fields:
- id
- owner address
- official wallet address (API/display alias for owner address)
- name
- optional description
- created timestamp

### 5.2 Drop Task

A task may have one optional `task_drop_id`.

Rules:
- null means the task is not part of a drop
- non-null means the task belongs to one drop
- v1 does not support changing this after creation

### 5.3 Drop Subscription

A subscription belongs to one drop and one email address.

Rules:
- same email can subscribe to multiple drops
- same email cannot have duplicate active subscription rows for the same drop
- unsubscribe affects only that drop

## 6. User Journeys

### 6.1 Publish With No Drop

1. Requester opens task creation.
2. Requester reaches the Task Drop step.
3. Requester leaves selection as `No drop`.
4. Requester publishes the task.
5. Backend creates task normally.
6. No Task Drops email is sent.

### 6.2 Publish Into Existing Drop

1. Requester opens task creation.
2. Requester reaches the Task Drop step.
3. UI lists drops owned by the connected wallet.
4. Requester selects one drop.
5. Requester publishes the task.
6. Backend verifies the selected drop is owned by the X402 payer.
7. Backend creates the task with `task_drop_id`.
8. Backend emails subscribers of that drop.

### 6.3 Publish While Creating a New Drop

1. Requester opens task creation.
2. Requester reaches the Task Drop step.
3. Requester chooses `Create new drop`.
4. Requester enters drop name and optional description.
5. Requester publishes the task.
6. Backend creates the drop for the X402 payer.
7. Backend creates the task with `task_drop_id`.
8. No subscribers may exist yet, so no email may be sent.
9. Success state links to the task and the new drop page.

### 6.4 Subscribe to a Drop

1. Worker opens a Task Drop page.
2. Worker reviews the drop name, description, owner, and current tasks.
3. Worker enters email.
4. Backend creates a subscription scoped to that drop.
5. Worker receives future new-task emails only for that drop.

## 7. Functional Requirements

### 7.1 Task Creation

FR-001: The task creation wizard must include a Task Drop step.  
FR-002: The Task Drop step must offer three choices: no drop, existing drop, create new drop.  
FR-003: No drop must be the default.  
FR-004: Existing drop selection must show drops where `owner_address` matches the connected wallet.  
FR-005: Create new drop must collect name and optional description.  
FR-006: The publish review must show whether the task will notify drop subscribers.  
FR-007: The task create payload must include either `taskDropId`, `taskDropCreate`, or neither.  
FR-008: The task create payload must reject requests containing both `taskDropId` and `taskDropCreate`.  
FR-009: The task create response must include `taskDropId: string | null`.

### 7.2 Backend Ownership

FR-010: Drop ownership is the X402 payer address for inline drop creation.  
FR-011: Existing drop attachment must verify `drop.owner_address` equals `ctx.res.locals.payer`, case-insensitive.  
FR-012: A requester cannot attach a task to another requester's drop.  
FR-013: A requester cannot attach a task to a missing drop.  
FR-014: Owner addresses must be normalized to lowercase when stored.
FR-015: Public Task Drop responses must expose the owner as `officialWalletAddress` so subscribers can distinguish drops by the requester wallet behind them.

### 7.3 Subscription

FR-020: Subscribe input must require `taskDropId` and email.  
FR-021: Subscribe must fail if the drop does not exist.  
FR-022: Same email/drop subscription must be idempotent.  
FR-023: Same email may subscribe to multiple drops.  
FR-024: Unsubscribe must deactivate only one scoped subscription.  
FR-025: Global subscribe/status behavior must be removed from product UI.

### 7.4 Notification

FR-030: A task with no drop must not send Task Drops email.  
FR-031: A task with a drop must email only active subscriptions for that drop.  
FR-032: New-task email must include drop name, task summary, reward, mode, tags, task link, and scoped unsubscribe link.  
FR-033: Email idempotency key must include task id, drop id, and subscription id.  
FR-034: Email send failure must not fail task creation.

### 7.5 Public Surfaces

FR-040: Task detail must show attached drop when present.  
FR-041: Attached drop display must link to the drop page.  
FR-042: A public drop page is required in v1.  
FR-043: The drop page must be the canonical subscription surface.  
FR-044: The drop page must include name, description, official wallet address, tasks, and subscribe form.
FR-045: Drop page URL must be stable and shareable, using `/drops/[dropId]` in v1.  
FR-046: Task creation success must link to the drop page when a drop was created or selected.

### 7.6 Cleanup

FR-050: Remove first-run global Task Drops signup or hide it behind a feature flag.  
FR-051: Remove landing page copy that promises global drop signup.  
FR-052: Stop calling global `taskDrops.status` from onboarding.  
FR-053: Keep legacy global subscription rows in the DB but exclude them from new sends.

## 8. Non-Functional Requirements

NFR-001: Existing task creation payment and contract behavior must remain unchanged.  
NFR-002: Drops are offchain only in v1.  
NFR-003: New API inputs must be defined in `packages/shared` Zod schemas.  
NFR-004: Backend changes must follow the existing tRPC router and Drizzle patterns.  
NFR-005: Frontend work must happen in `apps/web`, not deprecated `apps/frontend`.  
NFR-006: No emojis may be introduced anywhere.  
NFR-007: Existing clients that omit drop fields must keep creating tasks successfully.  
NFR-008: Notification delivery is best-effort in v1, matching current email behavior.

## 9. Technical Design

### 9.1 Database

Add `task_drops`:

```sql
CREATE TABLE "task_drops" (
  "id" text PRIMARY KEY,
  "owner_address" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "idx_task_drops_owner"
  ON "task_drops" (lower("owner_address"));
```

Add task attachment:

```sql
ALTER TABLE "tasks" ADD COLUMN "task_drop_id" text;

CREATE INDEX "idx_tasks_task_drop"
  ON "tasks" ("task_drop_id");
```

Scope subscriptions:

```sql
ALTER TABLE "task_drop_subscriptions" ADD COLUMN "task_drop_id" text;

DROP INDEX IF EXISTS "uidx_task_drop_subscriptions_email";

CREATE UNIQUE INDEX "uidx_task_drop_subscriptions_drop_email"
  ON "task_drop_subscriptions" ("task_drop_id", lower("email"))
  WHERE "task_drop_id" IS NOT NULL;

CREATE INDEX "idx_task_drop_subscriptions_drop"
  ON "task_drop_subscriptions" ("task_drop_id");
```

Legacy rows with `task_drop_id IS NULL` stay in place but are ignored by scoped sends.

### 9.2 Shared Schemas

Add:

```typescript
export const TaskDropCreateInlineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});

export const TaskDropSubscribeInputSchema = z.object({
  taskDropId: z.string().min(1),
  email: EmailAddress,
  walletAddress: EthAddress.optional(),
  source: TaskDropSourceSchema.optional().default('drop_page'),
});
```

Extend `TaskCreateSchema`:

```typescript
taskDropId: z.string().optional(),
taskDropCreate: TaskDropCreateInlineSchema.optional(),
```

Add refinement:

```typescript
.refine((input) => !(input.taskDropId && input.taskDropCreate), {
  message: 'Provide taskDropId or taskDropCreate, not both',
  path: ['taskDropId'],
})
```

Extend task response:

```typescript
taskDropId: z.string().nullable().optional(),
taskDrop: z.object({
  id: z.string(),
  name: z.string(),
}).nullable().optional(),
```

### 9.3 Backend Task Creation Flow

Update `tasks.create`:

1. Read X402 payer from `ctx.res.locals.payer`.
2. Resolve drop choice:
   - no drop: `resolvedTaskDropId = null`
   - existing drop: fetch drop and verify owner equals payer
   - new drop: create drop row owned by payer
3. Call `contractCreateTask`.
4. Insert task row with `taskDropId`.
5. Send worker-agent notification as today.
6. If `taskDropId` exists, call scoped Task Drops notifier.
7. Return `{ success: true, taskId, taskDropId }`.

Important v1 trade-off:
- Existing drop ownership validation happens after X402 settlement.
- This is acceptable for lean v1 because the web UI lists only the connected wallet's drops and the backend still enforces ownership.
- If this becomes a support issue, add a narrow preflight endpoint before adding a generic X402 hook.

### 9.4 Scoped Notifier

Replace global notifier behavior with:

```typescript
notifyTaskDropSubscribers({
  db,
  taskDropId,
  taskId,
  description,
  reward,
  mode,
  tags,
})
```

Behavior:
1. Load drop by `taskDropId`.
2. Select active subscriptions where `task_drop_id = taskDropId`.
3. Send email in chunks as today.
4. Use idempotency key `task-drop-${taskDropId}-${taskId}-${subscription.id}`.
5. Log failures and return `{ sent, failed, total }`.

Tasks without a drop never call this function.

### 9.5 Subscribe and Status API

Change `taskDrops.subscribe`:
- requires `taskDropId`
- looks up existing subscription by `(taskDropId, lower(email))`
- reactivates unsubscribed row
- sends welcome email scoped to the drop

Change `taskDrops.status`:
- requires `taskDropId`
- accepts email or wallet address
- returns status for that drop only

Legacy global subscribe/status endpoints:
- may remain temporarily for compatibility
- must not be used by product UI
- must not feed new-task sends

### 9.6 Frontend Wizard

Update create wizard steps:

```text
Template -> Brief -> Task Drop -> Publish
```

Task Drop step UI:
- `No drop`
- `Existing drop`
- `Create new drop`

Existing drop:
- query drops by owner address
- if empty, show create-new-drop option

Create new:
- name input
- description textarea

Publish step:
- shows selected drop state
- shows whether subscribers will be notified

### 9.7 Public Drop Page

Task detail:
- if task has drop, show drop name near task metadata
- link to the drop page

Drop page:
- route: `/drops/[dropId]`
- name
- description
- owner address
- open tasks in the drop
- recently completed tasks in the drop if available from existing task status
- subscribe form scoped to the drop
- already-subscribed state when status can be resolved from email or wallet

The drop page should be functional, not a marketing page. It is a work stream page where the primary actions are inspecting tasks and subscribing.

## 10. API Examples

### 10.1 Create Task With No Drop

```json
{
  "description": "Build a CLI parser",
  "reward": "5000000",
  "duration": 72,
  "mode": "bounty",
  "tags": ["cli"]
}
```

Response:

```json
{
  "success": true,
  "taskId": "0x...",
  "taskDropId": null
}
```

### 10.2 Create Task With Existing Drop

```json
{
  "description": "Build a CLI parser",
  "reward": "5000000",
  "duration": 72,
  "mode": "bounty",
  "tags": ["cli"],
  "taskDropId": "drop_123"
}
```

Response:

```json
{
  "success": true,
  "taskId": "0x...",
  "taskDropId": "drop_123"
}
```

### 10.3 Create Task With New Drop

```json
{
  "description": "Audit install docs",
  "reward": "8000000",
  "duration": 48,
  "mode": "bounty",
  "tags": ["docs", "qa"],
  "taskDropCreate": {
    "name": "Documentation QA Batch",
    "description": "Recurring QA tasks for docs and setup flows."
  }
}
```

Response:

```json
{
  "success": true,
  "taskId": "0x...",
  "taskDropId": "drop_456"
}
```

### 10.4 Subscribe to Drop

```json
{
  "taskDropId": "drop_456",
  "email": "worker@example.com",
  "source": "drop_page"
}
```

Response:

```json
{
  "subscribed": true,
  "alreadySubscribed": false,
  "email": "worker@example.com",
  "taskDropId": "drop_456"
}
```

## 11. Migration Plan

1. Add `task_drops`.
2. Add `tasks.task_drop_id`.
3. Add `task_drop_subscriptions.task_drop_id`.
4. Replace global email unique index with scoped partial unique index.
5. Update notifier to require `taskDropId`.
6. Update task creation to call notifier only when `taskDropId` exists.
7. Add public drop page route and scoped subscribe form.
8. Remove product UI calls to global subscribe/status.
9. Leave existing legacy rows untouched with `task_drop_id IS NULL`.

## 12. Testing Strategy

### 12.1 Backend Tests

Add tests:
- create task with no drop returns `taskDropId: null`
- create task with inline drop creates drop and task attachment
- create task with existing owned drop attaches task
- create task with another owner's drop fails
- payload with both drop fields fails schema validation
- no-drop task does not call Task Drops notifier
- drop task calls scoped notifier with `taskDropId`
- scoped subscribe allows same email across different drops
- scoped subscribe prevents duplicate same email/drop rows
- unsubscribe only deactivates one scoped row
- legacy null-drop subscriptions are ignored by notifier

### 12.2 Frontend Tests

Add tests:
- Task Drop step appears between Brief and Publish
- no drop is default
- existing drop selection sends `taskDropId`
- create new drop sends `taskDropCreate`
- publish review shows no-notification state for no drop
- publish review shows notification state for selected drop
- task creation success links to drop page when applicable
- drop page renders drop metadata, task list, and subscribe form
- task detail links attached drop to drop page
- first-run global signup is removed or hidden

### 12.3 Email Tests

Add tests:
- welcome email includes drop name
- new-task email includes drop name and task link
- unsubscribe link is scoped to subscription
- idempotency key includes drop id

## 13. Rollout Plan

### Phase 1: Data and Backend

- Add DB fields.
- Add shared schemas.
- Add task create drop resolution.
- Add scoped notifier.
- Add scoped subscribe/status.
- Disable global notifier path.

### Phase 2: Web Create Flow

- Add Task Drop step.
- Add owner drop query.
- Add payload mapping.
- Add publish review summary.
- Remove first-run global Task Drops signup.

### Phase 3: Public Subscription

- Add `/drops/[dropId]`.
- Show drop metadata, task list, and subscribe form on the drop page.
- Link attached drops from task detail to the drop page.
- Add scoped subscribe form.

## 14. Acceptance Criteria

Lean v1 is complete when:
- A requester can publish a task with no drop.
- A requester can publish a task into an existing owned drop.
- A requester can create a new drop while publishing a task.
- A task stores `task_drop_id` when attached to a drop.
- A subscriber can subscribe to one drop.
- Each drop has a public page where people can subscribe.
- Subscribers receive emails only for tasks in that drop.
- Tasks without drops send no Task Drops email.
- Task detail links to the attached drop page.
- Existing global Task Drops signup is no longer active in product UI.
- Existing task creation without drop fields remains compatible.

## 15. Deferred Work

Explicitly defer:
- edit/archive drop management
- standalone drop creation
- signed-wallet auth for free drop management
- notification outbox
- CLI support
- public drops directory beyond direct `/drops/[dropId]` pages
- post-publish attach/move/detach
- legacy subscriber reactivation campaign
- pre-settlement ownership validation hook

These should be reconsidered only after lean v1 shows that requesters create drops and subscribers engage with drop emails.

## 16. Recommended V1 Decisions

1. Ship only creation-time drop selection.
2. Use offchain drop records.
3. Store owner as lowercase X402 payer address.
4. Default to no drop.
5. Require a public drop page for subscription.
6. Keep notification best-effort.
7. Remove global Task Drops UI.
8. Keep legacy global rows but ignore them.
9. Defer all standalone management until needed.
