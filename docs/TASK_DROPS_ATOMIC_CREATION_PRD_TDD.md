# Task Drops Atomic Creation
## Product Requirements Document (PRD) + Technical Design Document (TDD)

Document owner: Product + Backend + Frontend  
Last updated: July 3, 2026  
Status: Superseded by `TASK_DROPS_LEAN_PRD_TDD.md`

## 1. Executive Summary

Task Drops must be created or selected as part of task creation. There is no separate v1 workflow where a task is published first and attached to a drop later.

This matters because task creation is paid, onchain, and requester-owned. If Task Drops are implemented as a loose post-creation action, the product can create inconsistent states:
- a paid task exists but the intended drop attachment fails
- a requester pays before learning they cannot use a selected drop
- global Task Drops subscriptions continue to receive unrelated tasks
- an indexer-created placeholder task races the richer task insert and loses drop metadata
- users subscribe to the wrong scope because old global subscribe surfaces remain active

The v1 rule is:

> A task is either published with no drop, published into an existing owned drop, or published while creating a new owned drop. That choice is validated before payment settlement and persisted with the task creation write path.

Task Drops remain offchain in v1. The onchain task lifecycle stays unchanged. The product guarantee is an atomic user-facing creation flow, not an onchain drop primitive.

## 2. Current System Trace

### 2.1 Existing Task Creation Flow

Current web flow:
1. User completes the create task wizard in `apps/web`.
2. `StepPublish` builds a task payload.
3. Browser sends `POST /api/tasks` without payment signature.
4. Backend validates the body with `TaskCreateSchema`.
5. X402 middleware returns payment terms.
6. Browser signs EIP-3009 payment authorization.
7. Browser sends `POST /api/tasks` with `payment-signature`.
8. X402 middleware settles payment with the facilitator.
9. `tasks.create` reads `ctx.res.locals.payer`.
10. Backend calls `contractCreateTask`.
11. Backend inserts the task row.
12. Backend fire-and-forgets worker notifications and global Task Drops notifications.

Critical files:
- `apps/web/components/market/wizard/step-publish.tsx`
- `apps/backend/src/app.ts`
- `apps/backend/src/middleware/x402.ts`
- `apps/backend/src/routers/tasks.router.ts`
- `apps/backend/src/services/task-drops-email.ts`

### 2.2 Existing Task Drops Flow

Current Task Drops behavior:
- `task_drop_subscriptions` is a global subscriber table.
- `taskDrops.subscribe` subscribes an email globally.
- `taskDrops.status` checks global email/wallet subscription state.
- `notifyTaskDropSubscribers` sends every created task to every active subscriber.

This must be replaced, not extended.

## 3. Problem Statement

Task Drops are currently named like a scoped subscription product but implemented as a global email blast. The first PRD corrected the product model but left several implementation hazards unresolved.

This PRD closes those gaps:
- Task Drop decision is part of task creation.
- Drop ownership is validated before payment settlement.
- Free drop management has a concrete wallet-auth model.
- Post-contract DB writes are idempotent and recoverable.
- Global subscription endpoints are retired or made explicitly legacy.
- Scoped notifications are durable enough for a subscriber product.
- CLI and API creation paths support the same drop semantics as the web app.

## 4. Goals and Non-Goals

### 4.1 Goals

1. Make Task Drop creation/selection a required decision point in task creation.
2. Preserve "no drop" as a valid explicit choice.
3. Validate selected drop ownership before payment settlement.
4. Create a new drop and the task attachment in the same task creation operation.
5. Attach a task to at most one drop in v1.
6. Send Task Drops emails only to subscribers of the attached drop.
7. Remove accidental global Task Drops subscription behavior from product surfaces.
8. Make post-contract DB persistence idempotent and recoverable.
9. Define signed-wallet auth for non-paid drop management.
10. Support the same drop creation semantics in web, CLI, and API.

### 4.2 Non-Goals

1. Onchain Task Drop state.
2. Post-publish attachment in v1.
3. Multi-drop syndication in v1.
4. Subscriber segmentation beyond drop membership.
5. Scheduled batch release.
6. Notifications for updates, cancellations, completions, or reminders.
7. Adding new work to deprecated `apps/frontend`.

## 5. Product Principles

### 5.1 Creation-Time Only

In v1, a task's drop membership is decided during task creation.

Allowed:
- publish task with no drop
- publish task into an existing owned active drop
- publish task while creating a new owned drop

Not allowed in v1:
- attach an already-created task to a drop
- move a task between drops
- attach one task to multiple drops
- attach to a drop owned by another requester

### 5.2 Scoped Subscription Only

A user subscribes to one drop, not to Taskmarket-wide task creation.

If a task has no drop, Task Drops subscribers receive no email for it.

### 5.3 No Payment for Invalid Drop Selection

If the selected drop is missing, archived, or not owned by the payer, the backend must reject before payment settlement.

This is a hard requirement because task creation is paid.

### 5.4 Offchain But Recoverable

Task Drop metadata is offchain. The contract does not know about drops. Because contract creation is irreversible, the backend must make the offchain writes idempotent and repairable.

## 6. Personas and Jobs-To-Be-Done

### 6.1 Requester

Needs to:
- create a named task drop while publishing a task
- reuse a drop for later task creation
- know whether subscribers will be notified before paying
- avoid accidentally notifying unrelated subscribers
- manage owned drops without paying for those management actions

### 6.2 Subscriber

Needs to:
- subscribe to a specific drop
- receive emails only for that drop
- understand why each email arrived
- unsubscribe from one drop without losing other subscriptions

### 6.3 Operator

Needs to:
- prevent invalid paid task creation attempts
- recover task/drop records after partial failures
- audit notification delivery by drop and task
- stop legacy global sends safely

## 7. End-to-End User Journeys

### 7.1 Publish With No Drop

1. Requester opens create task.
2. Requester reaches the Task Drop step.
3. Requester selects `No drop`.
4. Requester reviews payment.
5. Backend validates the payload.
6. X402 payment is settled.
7. Contract task is created.
8. Task row is persisted with `task_drop_id = null`.
9. No Task Drops email is queued.

### 7.2 Publish Into Existing Drop

1. Requester opens create task.
2. Requester reaches the Task Drop step.
3. UI lists active drops owned by the connected wallet.
4. Requester selects a drop.
5. Browser probes `/api/tasks`.
6. Backend validates body and records that the drop must belong to the eventual payer.
7. Browser signs payment.
8. On paid request, X402 middleware extracts payer before settlement.
9. Middleware verifies selected drop is active and owned by payer.
10. Payment is settled.
11. Contract task is created.
12. Task row is persisted with `task_drop_id`.
13. Scoped notification is queued for that drop's subscribers.

### 7.3 Publish While Creating New Drop

1. Requester opens create task.
2. Requester reaches the Task Drop step.
3. Requester selects `Create new drop`.
4. Requester enters drop name and optional description.
5. Browser probes `/api/tasks`.
6. Backend validates body, including drop fields.
7. Browser signs payment.
8. On paid request, X402 middleware extracts payer before settlement and validates the inline drop creation payload.
9. Payment is settled.
10. Contract task is created.
11. DB transaction creates the drop and upserts the task with the new `task_drop_id`.
12. Scoped notification is queued. The new drop may have zero subscribers.
13. Success page links to the task and the drop.

## 8. Functional Requirements

### 8.1 Task Creation Drop Step

FR-001: The create task wizard must include a dedicated Task Drop step between brief and publish.  
FR-002: The Task Drop step must require one explicit selection: no drop, existing drop, or create new drop.  
FR-003: The default selection is no drop.  
FR-004: Existing drop selection must list only active drops owned by the connected wallet.  
FR-005: Create new drop requires a name and may include description.  
FR-006: The publish review must summarize the chosen drop state before payment signing.  
FR-007: Post-publish attach, move, or detach is not included in v1.

### 8.2 Backend Task Creation Payload

FR-010: `TaskCreateSchema` must support `taskDropId`.  
FR-011: `TaskCreateSchema` must support `taskDropCreate`.  
FR-012: Payloads must not include both `taskDropId` and `taskDropCreate`.  
FR-013: Payloads may include neither, representing no drop.  
FR-014: `taskDropCreate.name` must be trimmed, required, and max 80 characters.  
FR-015: `taskDropCreate.description` must be trimmed and max 500 characters.  
FR-016: The task create response must include `taskDropId: string | null`.

### 8.3 Pre-Payment Drop Validation

FR-020: `/api/tasks` must reject malformed drop payloads before issuing payment terms.  
FR-021: On the paid request, X402 middleware must extract payer from the payment payload before facilitator settlement.  
FR-022: If `taskDropId` is present, middleware must verify the drop exists, is active, and is owned by payer before settlement.  
FR-023: If `taskDropCreate` is present, middleware must verify that the proposed owner can create a drop and that the owner/slug constraints will not fail before settlement.  
FR-024: If validation fails, the request must return a non-settling payment error and must not call the facilitator.  
FR-025: Router-level validation must repeat ownership/status checks after settlement as a defense-in-depth guard.

### 8.4 Drop Ownership and Management

FR-030: A drop is owned by a normalized requester wallet address.  
FR-031: Owner addresses must be stored lowercase.  
FR-032: A requester can list their own drops using signed-wallet auth.  
FR-033: A requester can update name/description using signed-wallet auth.  
FR-034: A requester can archive a drop using signed-wallet auth.  
FR-035: Archived drops cannot receive new tasks or new subscriptions.  
FR-036: Archived drops remain readable for historical task context.

### 8.5 Subscription

FR-040: `subscribe` requires `taskDropId` and email.  
FR-041: Subscribing to the same drop/email pair is idempotent.  
FR-042: The same email may subscribe to multiple drops.  
FR-043: Unsubscribe affects only one drop subscription.  
FR-044: Legacy global subscriptions must not receive new-task notifications.  
FR-045: Public subscribe endpoints must be rate-limited by IP, email, and drop id.

### 8.6 Notification

FR-050: A task without `task_drop_id` queues no Task Drops email.  
FR-051: A task with `task_drop_id` queues email only for active subscriptions on that drop.  
FR-052: New-task emails must include drop name, task description, reward, mode, tags, task link, and scoped unsubscribe link.  
FR-053: Notification idempotency must use `taskDropId`, `taskId`, and subscription id.  
FR-054: Notification delivery should use an outbox table, not direct fire-and-forget sends, unless product explicitly accepts best-effort loss.  
FR-055: Email logs must include task id, drop id, and subscription id.

### 8.7 CLI and API

FR-060: CLI task creation must support attaching to an existing drop.  
FR-061: CLI task creation must support creating a new drop inline.  
FR-062: CLI task creation must support explicit no-drop behavior by omission.  
FR-063: Public API documentation must show all three creation modes.  
FR-064: API clients that omit drop fields must keep working.

### 8.8 Existing Product Surface Cleanup

FR-070: Remove or disable global Task Drops signup from first-run onboarding.  
FR-071: Replace global landing-page Task Drops copy with links to specific drop pages or a drops directory.  
FR-072: Remove global `taskDrops.status` usage from onboarding progress.  
FR-073: Existing global subscription rows must be preserved for audit but excluded from sends.  
FR-074: Tests must fail if any task creation path calls a global all-subscribers notifier.

## 9. Non-Functional Requirements

NFR-001: Task creation payment semantics remain unchanged.  
NFR-002: Contract storage and onchain task lifecycle remain unchanged.  
NFR-003: Drop validation must happen before settlement where payer identity is required.  
NFR-004: Post-contract DB persistence must be idempotent.  
NFR-005: The indexer must not erase or block drop metadata.  
NFR-006: Shared Zod schemas must define all public input/output contracts.  
NFR-007: Database migrations must be backward compatible.  
NFR-008: No code, copy, comments, tests, or docs may use emojis.  
NFR-009: All wallet-auth messages must be domain-separated and nonce-protected where replay matters.  
NFR-010: Public subscription endpoints must avoid logging full email addresses in normal logs.

## 10. Technical Architecture

### 10.1 Data Model

Add `task_drops`:

```sql
CREATE TABLE "task_drops" (
  "id" text PRIMARY KEY,
  "owner_address" text NOT NULL,
  "owner_agent_id" text,
  "name" text NOT NULL,
  "description" text,
  "slug" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "archived_at" timestamp
);

CREATE UNIQUE INDEX "uidx_task_drops_owner_slug"
  ON "task_drops" (lower("owner_address"), "slug");

CREATE INDEX "idx_task_drops_owner"
  ON "task_drops" (lower("owner_address"));

CREATE INDEX "idx_task_drops_status"
  ON "task_drops" ("status");
```

Add nullable task attachment:

```sql
ALTER TABLE "tasks" ADD COLUMN "task_drop_id" text;
CREATE INDEX "idx_tasks_task_drop" ON "tasks" ("task_drop_id");
```

Update subscriptions:

```sql
ALTER TABLE "task_drop_subscriptions" ADD COLUMN "task_drop_id" text;

CREATE INDEX "idx_task_drop_subscriptions_drop"
  ON "task_drop_subscriptions" ("task_drop_id");

DROP INDEX IF EXISTS "uidx_task_drop_subscriptions_email";

CREATE UNIQUE INDEX "uidx_task_drop_subscriptions_scoped_email"
  ON "task_drop_subscriptions" ("task_drop_id", lower("email"))
  WHERE "task_drop_id" IS NOT NULL;

CREATE INDEX "idx_task_drop_subscriptions_legacy_global"
  ON "task_drop_subscriptions" (lower("email"))
  WHERE "task_drop_id" IS NULL;
```

Recommended outbox:

```sql
CREATE TABLE "task_drop_notification_outbox" (
  "id" text PRIMARY KEY,
  "task_drop_id" text NOT NULL,
  "task_id" text NOT NULL,
  "subscription_id" text NOT NULL,
  "email" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "sent_at" timestamp
);

CREATE UNIQUE INDEX "uidx_task_drop_notification_once"
  ON "task_drop_notification_outbox" ("task_drop_id", "task_id", "subscription_id");

CREATE INDEX "idx_task_drop_notification_pending"
  ON "task_drop_notification_outbox" ("status", "created_at");
```

### 10.2 Shared Schemas

Create or update schemas in `packages/shared/src/schemas/task-drops.schemas.ts`:

```typescript
const TaskDropId = z.string().min(1).max(128);
const TaskDropName = z.string().trim().min(1).max(80);
const TaskDropDescription = z.string().trim().max(500);

export const TaskDropCreateInlineSchema = z.object({
  name: TaskDropName,
  description: TaskDropDescription.optional(),
});

export const TaskDropCreateInputSchema = TaskDropCreateInlineSchema.extend({
  ownerAddress: EthAddress,
  signature: z.string().min(1),
  nonce: z.string().min(1),
});

export const TaskDropUpdateInputSchema = z.object({
  id: TaskDropId,
  name: TaskDropName.optional(),
  description: TaskDropDescription.optional(),
  ownerAddress: EthAddress,
  signature: z.string().min(1),
  nonce: z.string().min(1),
});

export const TaskDropSubscribeInputSchema = z.object({
  taskDropId: TaskDropId,
  email: EmailAddress,
  walletAddress: EthAddress.optional(),
  source: TaskDropSourceSchema.optional().default('drop_page'),
});
```

Extend task create:

```typescript
export const TaskCreateSchema = z.object({
  // existing fields
  taskDropId: TaskDropId.optional(),
  taskDropCreate: TaskDropCreateInlineSchema.optional(),
}).refine((input) => !(input.taskDropId && input.taskDropCreate), {
  message: 'Provide taskDropId or taskDropCreate, not both',
  path: ['taskDropId'],
});
```

Extend task response:

```typescript
taskDropId: z.string().nullable().optional(),
taskDrop: z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'archived']),
}).nullable().optional(),
```

### 10.3 Pre-Settlement Validation Hook

Extend X402 middleware:

```typescript
export interface X402Options {
  getAmount: (req: Request) => string;
  description?: string;
  preSettle?: (args: {
    req: Request;
    payer: string;
    paymentPayload: unknown;
  }) => Promise<void>;
}
```

Flow:
1. If no payment signature, return payment terms after basic body validation.
2. If payment signature exists, parse the payment payload.
3. Extract payer from `payload.authorization.from`.
4. Run `preSettle`.
5. If `preSettle` throws, return error without calling facilitator.
6. If `preSettle` succeeds, call facilitator `/settle`.
7. Continue to router.

For `/api/tasks`, `preSettle` must:
- parse `TaskCreateSchema`
- if no drop, pass
- if `taskDropId`, verify active owned drop
- if `taskDropCreate`, verify slug/name constraints for payer

### 10.4 Idempotent Task Persistence

After `contractCreateTask`, backend must persist task/drop data with a function like:

```typescript
persistCreatedTaskWithDrop({
  db,
  taskId,
  taskInput,
  payer,
  escrowTxHash,
  taskDropId,
  taskDropCreate,
});
```

Rules:
- Use one DB transaction.
- If inline drop creation is requested, insert the drop with deterministic id or idempotency key derived from task id.
- Upsert task by `id`.
- If an indexer placeholder exists, patch it with description, tags, requester pubkey, and `task_drop_id`.
- Never overwrite an existing non-null `task_drop_id` with null.
- Never change `task_drop_id` on an existing task except when patching a placeholder for the same creation request.

### 10.5 Indexer Compatibility

The indexer must preserve offchain drop metadata.

Requirements:
- `processTaskCreatedEvent` may insert placeholder tasks.
- Router persistence must be able to enrich that placeholder.
- Indexer updates must not set `task_drop_id`.
- Reconciliation scripts must not erase `task_drop_id`.

Add tests where:
1. Indexer inserts a placeholder task.
2. Router persistence runs for the same `taskId`.
3. Final row includes full task fields and `task_drop_id`.

### 10.6 Drop Management Auth

Use signed-wallet auth for free drop management operations.

Message format:

```text
taskmarket:task-drop:{action}:{dropIdOrNew}:{nonce}:{timestamp}
```

Actions:
- `create`
- `update`
- `archive`
- `list-mine`

Rules:
- Recover signer with `recoverMessageAddress`.
- Signer must match `ownerAddress`.
- Nonce must be single-use for mutating operations.
- Timestamp must be recent enough to reduce replay risk.
- Read-only `listMine` may use a signed message or a short-lived server session if a general auth layer is added later.

### 10.7 Notification Outbox

On successful task persistence:
1. If no drop, do nothing.
2. If drop exists, select active subscribers for that drop.
3. Insert one outbox row per subscription with unique key `(taskDropId, taskId, subscriptionId)`.
4. A worker processes pending rows and sends email.
5. Mark rows `sent` or increment attempts with `last_error`.

If v1 deliberately keeps fire-and-forget:
- PRD acceptance must explicitly accept lost notifications on process crash.
- Add a follow-up ticket for outbox.

Recommendation: implement outbox in v1 because Task Drops is a subscription product.

### 10.8 Email Scope

Welcome email:
- subject includes drop name
- body says the user subscribed to that specific drop
- CTA opens drop page
- footer unsubscribe is scoped to drop subscription

New-task email:
- subject includes drop name
- content includes task details
- footer says why the user received it
- tags include `task_drop_id`, `task_id`, and `type`

Unsubscribe token material:

```text
subscription.id:subscription.taskDropId:subscription.email
```

### 10.9 Frontend Create Wizard

Update wizard steps:

```text
Template -> Brief -> Task Drop -> Publish
```

Task Drop step:
- segmented control or radio group:
  - `No drop`
  - `Existing drop`
  - `Create new drop`
- existing drop select shows active owned drops
- create new fields:
  - name
  - description
- inline validation mirrors shared schema

Publish step:
- shows selected drop state
- states whether subscribers will be notified
- signs payment only after validation passes

Success route:
- if `taskDropId`, link to task and drop
- if no drop, link to task only

### 10.10 CLI

Update `taskmarket task create`:

```bash
taskmarket task create \
  --description "..." \
  --reward 5 \
  --duration 72 \
  --task-drop drop_123
```

```bash
taskmarket task create \
  --description "..." \
  --reward 5 \
  --duration 72 \
  --create-task-drop "Docs QA Batch" \
  --task-drop-description "Recurring docs QA tasks"
```

Rules:
- `--task-drop` and `--create-task-drop` are mutually exclusive.
- Omitting both means no drop.
- CLI sends the same task creation payload as web.

## 11. API Contracts

### 11.1 No Drop

Request:

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

### 11.2 Existing Drop

Request:

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

### 11.3 Inline New Drop

Request:

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

## 12. Migration Plan

### 12.1 Schema Migration

1. Add `task_drops`.
2. Add nullable `tasks.task_drop_id`.
3. Add nullable `task_drop_subscriptions.task_drop_id`.
4. Replace global unique email index with scoped partial unique index.
5. Add notification outbox table.
6. Deploy code that no longer sends global Task Drops emails.

### 12.2 Legacy Subscriber Handling

Legacy rows with `task_drop_id IS NULL`:
- stay in DB for audit
- are excluded from new-task sends
- are not silently subscribed to any drop
- may be used later for a one-time opt-in campaign

### 12.3 Endpoint Migration

Deprecated:
- `POST /task-drops/subscribe` without drop id
- `GET /task-drops/status` without drop id

New:
- `POST /task-drops/{taskDropId}/subscribe`
- `GET /task-drops/{taskDropId}/status`

Old endpoints should return `410 Gone` or a structured error once scoped subscriptions ship.

### 12.4 UI Migration

Remove or replace:
- first-run global Task Drops signup
- landing carousel `Sign up for drops` linking to `#`
- side-card global Task Drops copy
- any onboarding completion signal based on global `taskDrops.status`

Add:
- drop page subscription form
- task detail drop subscription form
- drops directory or requester drop list if needed

## 13. Rollout Plan

### Phase 1: Backend Safety Foundation

- Add schema and migrations.
- Add scoped schemas.
- Add pre-settlement validation hook to X402.
- Add idempotent task persistence helper.
- Disable global Task Drops notifier.
- Add backend tests.

### Phase 2: Atomic Create Flow

- Add Task Drop wizard step.
- Add create payload mapping.
- Add CLI flags.
- Update task create response.
- Add frontend and CLI tests.

### Phase 3: Scoped Subscriptions and Emails

- Add scoped subscribe/status endpoints.
- Add drop page.
- Add task detail drop affordance.
- Add outbox processor.
- Update email templates.

### Phase 4: Cleanup and Observability

- Retire legacy endpoints.
- Remove global promo copy.
- Add dashboards/log queries for outbox status.
- Monitor failed validation before settlement, create success rate, outbox sends, click-through, and unsubscribe rate.

## 14. Testing Strategy

### 14.1 Backend Unit Tests

Task create:
- no drop creates task with `taskDropId: null`
- existing owned active drop creates task with `taskDropId`
- inline drop creates drop and task in one persistence transaction
- both `taskDropId` and `taskDropCreate` fails schema validation
- archived drop fails pre-settlement
- other owner's drop fails pre-settlement
- router repeats ownership validation after settlement
- indexer placeholder is enriched instead of causing insert failure

X402:
- `preSettle` runs before facilitator call
- failed `preSettle` never calls facilitator
- successful `preSettle` continues to settlement

Subscriptions:
- same email can subscribe to two drops
- duplicate email/drop is idempotent
- legacy global rows are ignored by scoped sends
- unsubscribe affects one drop only

Notifications:
- no-drop task inserts no outbox rows
- drop task inserts one row per active scoped subscriber
- outbox unique key prevents duplicates
- email tags include task id and drop id

### 14.2 Frontend Tests

- wizard includes Task Drop step
- no drop is default
- existing drop selection sends `taskDropId`
- new drop sends `taskDropCreate`
- publish review shows notification scope
- invalid drop name blocks publish before payment
- success page links to drop when present

### 14.3 CLI Tests

- `--task-drop` maps to `taskDropId`
- `--create-task-drop` maps to `taskDropCreate`
- mutually exclusive flags are enforced
- omitting both sends no drop fields

### 14.4 Integration Tests

Full path:
1. Create a drop.
2. Subscribe an email to the drop.
3. Publish a task into the drop.
4. Assert task has `task_drop_id`.
5. Assert outbox has one scoped row.
6. Publish a task with no drop.
7. Assert no Task Drops outbox row.

Failure path:
1. Create a drop for owner A.
2. Attempt to publish into it as owner B.
3. Assert facilitator is not called.
4. Assert no contract call.
5. Assert no task row.

Indexer path:
1. Simulate `TaskCreated` indexer insert.
2. Run task persistence helper for same task.
3. Assert row is enriched with description and drop id.

## 15. Observability

Track:
- `task_drop_pre_settle_validation_failed`
- `task_drop_created_inline`
- `task_drop_created_standalone`
- `task_created_without_drop`
- `task_created_with_drop`
- `task_drop_notification_outbox_inserted`
- `task_drop_notification_sent`
- `task_drop_notification_failed`
- `task_drop_subscription_created`
- `task_drop_subscription_unsubscribed`

Log fields:
- `taskDropId`
- `taskId`
- `ownerAddress`
- `payerAddress`
- `subscriptionId`
- `emailDomain`
- `failureReason`
- `preSettleRejected`

Do not log full email addresses in normal logs.

## 16. Acceptance Criteria

The feature is complete when:
- Task creation includes a dedicated Task Drop decision.
- A task can be created with no drop.
- A task can be created into an existing owned active drop.
- A task can create a new drop inline and attach to it.
- Invalid drop selection fails before X402 settlement.
- No post-publish attach flow exists in v1.
- Scoped subscriptions require a drop id.
- No global Task Drops notification path remains active.
- Task Drops emails are queued only for subscribers of the attached drop.
- Legacy global subscription rows do not receive new-task emails.
- CLI and web support the same creation semantics.
- Indexer placeholder races do not lose drop metadata.

## 17. Open Decisions

1. Should v1 include the outbox table, or explicitly accept best-effort notification loss?
2. Should standalone drop creation be available before a requester publishes the first task into it?
3. Should `listMine` use signed messages on every request or a short-lived wallet session?
4. Should public drop URLs use only id in v1, or include owner slug plus drop slug?
5. Should legacy global subscribers get a one-time invitation to choose drops?

## 18. Recommended Decisions

1. Include the outbox table in v1.
2. Use a dedicated wizard step: `Template -> Brief -> Task Drop -> Publish`.
3. Keep post-publish attach out of v1.
4. Require drop ownership validation in X402 `preSettle`.
5. Use id-based public drop URLs in v1.
6. Return `410 Gone` from legacy global subscribe/status endpoints after rollout.
7. Keep legacy global subscriptions for audit only.
8. Use signed-wallet auth for standalone drop management until a general session layer exists.
