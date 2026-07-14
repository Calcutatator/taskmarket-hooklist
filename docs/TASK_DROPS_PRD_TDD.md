# Task Drops
## Product Requirements Document (PRD) + Technical Design Document (TDD)

Document owner: Product + Backend + Frontend  
Last updated: July 3, 2026  
Status: Superseded by `TASK_DROPS_LEAN_PRD_TDD.md`

## 1. Executive Summary

Task Drops should become requester-owned collections of tasks that people can subscribe to. A subscriber should receive notifications only for tasks attached to the specific drop they subscribed to, not for every task created across Taskmarket.

The current implementation treats Task Drops as a global email list. Any successful task creation sends a new-task email to every active row in `task_drop_subscriptions`. This is too broad and makes the subscription promise inaccurate.

This project changes Task Drops into a real product object:
- A requester can create a Task Drop scoped to their account.
- During task creation, the requester can create a new drop or attach the task to an existing drop.
- Later tasks can be attached to the same drop.
- Users subscribe to specific drops.
- Notifications are sent only to subscribers of the drop attached to the newly created task.
- Tasks can still be created without a drop, in which case no Task Drops email is sent.

## 2. Product Context

### 2.1 Current Behavior

Today:
- `task_drop_subscriptions` stores a global active subscriber list.
- `tasks.create` calls `notifyTaskDropSubscribers(...)` after a task is escrowed and inserted.
- `notifyTaskDropSubscribers(...)` selects all active subscriptions and sends every subscriber the same email.
- The UI copy refers to drops and batches, but the backend has no `task_drops` entity, no requester ownership, and no task-to-drop relationship.

### 2.2 Problem Statement

Global notification breaks user expectations:
- Subscribers cannot choose which requester, batch, campaign, or drop they care about.
- High-volume task creation can spam subscribers.
- Requesters cannot build an audience around a specific recurring drop.
- The product cannot represent "this task is part of that drop" anywhere in the marketplace.
- Unsubscribe is all-or-nothing instead of scoped to a drop.

### 2.3 Opportunity

Task Drops can become a lightweight publishing primitive for requesters:
- Requesters can create repeatable task campaigns.
- Subscribers can opt into specific work streams.
- Task announcements become more relevant.
- Drop pages can become shareable acquisition surfaces.
- Future matching, segmentation, and analytics can be built on an explicit drop model.

## 3. Goals and Non-Goals

### 3.1 Goals

1. Add a first-class Task Drop entity scoped to the creator/requester account.
2. Let requesters attach a task to a drop during task creation.
3. Let requesters create a new drop inline during task creation.
4. Let requesters reuse an existing drop for later tasks.
5. Send Task Drops emails only for tasks attached to a drop.
6. Send each Task Drops email only to active subscribers of that specific drop.
7. Preserve existing task creation, escrow, and onchain behavior.
8. Provide public subscription surfaces for individual drops.
9. Provide requester management surfaces for creating, viewing, and archiving drops.
10. Create a migration path from the current global subscriber table without silently subscribing users to every future drop.

### 3.2 Non-Goals

1. Creating a new onchain primitive for drops.
2. Supporting one task in multiple drops in v1.
3. Replacing task tags or task modes.
4. Building advanced subscriber segmentation in v1.
5. Building a bulk campaign scheduler in v1.
6. Notifying subscribers about task updates, cancellations, or completions in v1.
7. Adding new features to deprecated `apps/frontend`.

## 4. Personas and Jobs-To-Be-Done

### 4.1 Requester

Needs to:
- Create a named drop for a campaign, batch, client need, or recurring work stream.
- Attach new tasks to that drop while publishing.
- Reuse the same drop across many tasks.
- Share a drop page so interested workers can subscribe.
- Avoid notifying unrelated subscribers.

### 4.2 Worker or Subscriber

Needs to:
- Understand what a specific drop is about.
- Subscribe only to drops they care about.
- Receive relevant notifications when new tasks are added to that drop.
- Unsubscribe from one drop without losing subscriptions to others.

### 4.3 Operator

Needs to:
- Preserve deliverability and unsubscribe compliance.
- Trace which drop caused an email to be sent.
- Avoid duplicate emails for the same task/drop/subscriber combination.
- Migrate existing global subscriptions safely.

## 5. Success Metrics

### 5.1 Product KPIs

1. At least 80% of Task Drops emails in production include a `taskDropId`.
2. Click-through rate from Task Drops emails improves relative to the global list baseline.
3. Unsubscribe rate per new-task email decreases relative to the global list baseline.
4. Requesters create repeat drops: at least 30% of drops receive two or more tasks within 30 days.
5. Users subscribe to specific drops from public drop pages or task detail pages.

### 5.2 Engineering KPIs

1. No task creation regression: task creation success rate remains unchanged.
2. Notification failure never fails task creation.
3. Duplicate email sends are prevented with idempotency by `taskId`, `taskDropId`, and `subscriptionId`.
4. All new backend behavior is covered by unit tests.
5. All new web create-flow behavior is covered by component tests.

## 6. Core Product Model

### 6.1 Definitions

Task Drop:
A requester-owned collection of tasks. A drop has a name, description, owner, status, and public subscription page.

Drop owner:
The wallet/requester account that created the drop. Only the owner can edit the drop or attach tasks to it.

Drop subscriber:
An email address, optionally associated with a wallet, that opted into notifications for one specific drop.

Drop task:
A task that is attached to a drop. In v1, a task can belong to zero or one drop.

### 6.2 Ownership Rules

1. A drop is scoped to the account that creates it.
2. A requester can attach a task only to a drop they own.
3. If the same person has multiple wallet addresses, v1 treats each wallet as a separate owner unless an existing account abstraction already links them.
4. Drop ownership is offchain and stored in Postgres.
5. Onchain task settlement remains unchanged.

### 6.3 Notification Rule

When a task is created:
- If `taskDropId` is absent, do not send a Task Drops email.
- If `taskDropId` is present and valid, send a new-task email only to active subscriptions for that drop.
- If `taskDropId` points to an archived drop, reject the task creation request before payment settlement where possible.
- If email sending fails after task creation, log the failure and keep task creation successful.

## 7. User Journeys

### 7.1 Requester Creates a New Drop During Task Creation

1. Requester opens the task creation wizard.
2. Requester writes the brief and reaches the publish review step.
3. Wizard shows a "Task Drop" section.
4. Requester chooses "Create a new drop".
5. Requester enters drop name and optional description.
6. Requester publishes the task.
7. Backend creates the drop, creates the task, attaches the task to the drop, and notifies subscribers.
8. Since the drop is new, it may have zero subscribers; notification result records zero sends.
9. Success screen links to the task and the drop page.

### 7.2 Requester Adds a Task to an Existing Drop

1. Requester opens the task creation wizard.
2. Wizard loads active drops owned by the connected wallet.
3. Requester selects an existing drop.
4. Requester publishes the task.
5. Backend verifies ownership and attaches the task.
6. Subscribers to that drop receive the new-task email.

### 7.3 Requester Creates a Task Without a Drop

1. Requester opens the task creation wizard.
2. Requester leaves Task Drop set to "No drop".
3. Requester publishes the task.
4. Backend creates the task normally.
5. No Task Drops subscriber email is sent.
6. Existing targeted worker-agent notifications can still run independently.

### 7.4 Worker Subscribes to a Specific Drop

1. Worker visits a public drop page or a task detail page showing the attached drop.
2. Worker enters an email address.
3. Backend creates or reactivates a subscription scoped to that drop.
4. Worker receives a welcome email for that drop.
5. Worker receives future emails only for tasks attached to that drop.

### 7.5 Subscriber Unsubscribes From One Drop

1. Subscriber clicks the unsubscribe link in a Task Drops email.
2. Backend verifies token for that drop subscription.
3. The subscription status changes to `unsubscribed`.
4. Other drop subscriptions for the same email remain active.

## 8. Functional Requirements

### 8.1 Drop Management

FR-001: Authenticated requesters must be able to create a Task Drop with a name and optional description.  
FR-002: A Task Drop must be owned by the requester wallet address that created it.  
FR-003: A requester must be able to list their own active and archived drops.  
FR-004: A requester must be able to update a drop name and description.  
FR-005: A requester must be able to archive a drop so it can no longer receive new tasks or subscribers.  
FR-006: Archived drops must remain readable for historical task context.

### 8.2 Task Creation Attachment

FR-010: The task creation payload must support `taskDropId` for attaching to an existing drop.  
FR-011: The task creation payload must support inline `taskDropCreate` for creating a drop and attaching the task to it in the same operation.  
FR-012: The API must reject payloads that include both `taskDropId` and `taskDropCreate`.  
FR-013: The API must verify that `taskDropId` belongs to the payer/requester.  
FR-014: A task can be created with no drop.  
FR-015: In v1, a task can be attached to only one drop.  
FR-016: The created task response should include `taskDropId` when a drop was attached.

### 8.3 Subscription

FR-020: Users must subscribe to a specific drop, not to a global Task Drops list.  
FR-021: Subscription input must require `taskDropId` and `email`.  
FR-022: Subscription may include `walletAddress` for status lookup and future personalization.  
FR-023: Subscribing to the same drop with an active email must return `alreadySubscribed: true`.  
FR-024: Re-subscribing to a previously unsubscribed drop must reactivate that drop subscription.  
FR-025: The same email may subscribe to multiple drops.  
FR-026: Unsubscribe must deactivate only one drop subscription.

### 8.4 Notification

FR-030: Task Drops new-task emails must be sent only when a created task is attached to a drop.  
FR-031: New-task emails must be sent only to active subscribers for that drop.  
FR-032: Email content must include drop name, task description, reward, mode, tags, task link, and unsubscribe link.  
FR-033: Welcome emails must include drop name and a link to the drop page.  
FR-034: Idempotency key must include `taskId`, `taskDropId`, and subscription id.  
FR-035: Notification failures must be logged but must not fail task creation.

### 8.5 Public Surfaces

FR-040: Public task detail pages must show the attached drop when present.  
FR-041: A public drop page must show drop name, description, owner/requester, recent tasks, and subscription form.  
FR-042: The drop page must have a stable shareable URL.  
FR-043: The task creation success state must link to the drop when the task was attached to one.

### 8.6 Requester Surfaces

FR-050: The dashboard must provide a way for requesters to view their drops.  
FR-051: The task creation wizard must include a Task Drop stage or publish-section control with three choices: no drop, existing drop, create new drop.  
FR-052: Existing drop selection must show only drops owned by the connected wallet.  
FR-053: The UI must explain attachment consequences through labels and state, not lengthy instructional text.

## 9. Non-Functional Requirements

NFR-001: Existing task creation and onchain escrow semantics must remain unchanged.  
NFR-002: Backend validation must use shared Zod schemas in `packages/shared`.  
NFR-003: Database access must follow existing Drizzle patterns.  
NFR-004: New backend logic must be implemented through tRPC routers and service-layer helpers.  
NFR-005: Human web product work must be built in `apps/web`, not deprecated `apps/frontend`.  
NFR-006: Email sending must remain fire-and-forget from task creation.  
NFR-007: All unsubscribe tokens must be scoped to the subscription id and drop id.  
NFR-008: No emojis may be introduced in code, strings, docs, or tests.  
NFR-009: The system must remain backward compatible for task listing and task detail consumers that do not know about drops.

## 10. Technical Design

### 10.1 Database Schema

Add a first-class `task_drops` table:

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
  ON "task_drops" ("owner_address", "slug");

CREATE INDEX "idx_task_drops_owner"
  ON "task_drops" ("owner_address");

CREATE INDEX "idx_task_drops_status"
  ON "task_drops" ("status");
```

Add a nullable drop reference to `tasks`:

```sql
ALTER TABLE "tasks" ADD COLUMN "task_drop_id" text;
CREATE INDEX "idx_tasks_task_drop" ON "tasks" ("task_drop_id");
```

Update `task_drop_subscriptions` so subscriptions are scoped to a drop:

```sql
ALTER TABLE "task_drop_subscriptions" ADD COLUMN "task_drop_id" text;
CREATE INDEX "idx_task_drop_subscriptions_drop"
  ON "task_drop_subscriptions" ("task_drop_id");

DROP INDEX IF EXISTS "uidx_task_drop_subscriptions_email";

CREATE UNIQUE INDEX "uidx_task_drop_subscriptions_drop_email"
  ON "task_drop_subscriptions" ("task_drop_id", lower("email"));
```

Migration note: existing global subscriptions must not be automatically applied to every new drop. See Section 14.

### 10.2 Shared Schemas

Add new schemas in `packages/shared/src/schemas/task-drops.schemas.ts`:

```typescript
export const TaskDropCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});

export const TaskDropUpdateInputSchema = TaskDropCreateInputSchema.extend({
  id: z.string().min(1),
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
taskDropCreate: TaskDropCreateInputSchema.optional(),
```

Add a refinement:

```typescript
.refine((input) => !(input.taskDropId && input.taskDropCreate), {
  message: 'Provide taskDropId or taskDropCreate, not both',
  path: ['taskDropId'],
})
```

Extend task response schemas with:

```typescript
taskDropId: z.string().nullable().optional(),
taskDrop: z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
}).nullable().optional(),
```

### 10.3 Backend Router Design

Add or expand `taskDropsRouter`:

| Procedure | Method | Purpose |
|---|---|---|
| `create` | `POST /task-drops` | Create requester-owned drop |
| `listMine` | `GET /task-drops/mine` | List drops owned by connected wallet |
| `get` | `GET /task-drops/{id}` | Public drop detail |
| `tasks` | `GET /task-drops/{id}/tasks` | Public tasks in drop |
| `update` | `PATCH /task-drops/{id}` | Owner updates name/description |
| `archive` | `POST /task-drops/{id}/archive` | Owner archives drop |
| `subscribe` | `POST /task-drops/{id}/subscribe` | Subscribe to one drop |
| `status` | `GET /task-drops/{id}/status` | Check scoped subscription status |

If `listMine`, `create`, `update`, and `archive` need wallet identity but not payment, add an auth pattern consistent with the existing wallet/session stack. If no general web auth middleware exists, v1 can derive owner from the connected wallet only where the endpoint is called as part of X402 task creation. Standalone management should not ship until ownership can be verified.

### 10.4 Task Creation Transaction Shape

Task creation currently:
1. Verifies X402 payer.
2. Calls contract to create task.
3. Inserts task row.
4. Sends notifications.

Updated flow:
1. Verify X402 payer.
2. Validate drop input:
   - no drop
   - existing owned active drop
   - new drop to create for payer
3. Precompute task id.
4. Call contract to create task.
5. In one DB transaction:
   - create drop if `taskDropCreate` is present
   - insert task with `task_drop_id`
6. Fire targeted worker notification as today.
7. If `task_drop_id` exists, fire scoped Task Drops notification.
8. Return `{ success: true, taskId, taskDropId }`.

The DB transaction starts after the contract call because onchain escrow remains the irreversible step. If DB insert fails after contract success, existing recovery paths for task creation should be used or expanded; this project should not introduce a new partial-write class.

### 10.5 Notification Service Changes

Replace global `notifyTaskDropSubscribers(...)` with scoped behavior:

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

Service behavior:
- Load the drop by `taskDropId`.
- Return `{ sent: 0, failed: 0, total: 0 }` if drop is missing or archived.
- Select active subscriptions where `task_drop_id = taskDropId`.
- Render emails with drop name and task details.
- Use idempotency key `task-drop-${taskDropId}-${taskId}-${subscription.id}`.
- Log send failures with task id and drop id.

### 10.6 Email Templates

Update welcome email:
- Subject: `Subscribed: {dropName}`
- Preview: `You will get new tasks from {dropName}.`
- CTA: open drop page.
- Footer: unsubscribe from this drop.

Update new-task email:
- Subject: `{dropName}: new task`
- Include:
  - drop name
  - reward
  - mode
  - tags
  - task snippet
  - task link
  - unsubscribe link scoped to that drop subscription

### 10.7 Unsubscribe Tokens

Current token material:

```text
subscription.id:subscription.email
```

New token material:

```text
subscription.id:subscription.taskDropId:subscription.email
```

This prevents a token from being meaningful outside the specific drop subscription.

### 10.8 Frontend Create Flow

Add Task Drop selection to `apps/web` create task flow.

Recommended v1 placement:
- Add the control to the publish review step, because the user is making a publishing/distribution decision.
- If user testing shows it is too late, promote it to a dedicated wizard step between Brief and Publish.

Control states:
- `No drop`
- `Existing drop`
- `Create new drop`

Existing drop state:
- Query requester-owned active drops.
- Render a select/menu with drop name and task count.
- Empty state offers "Create new drop".

Create new drop state:
- Fields: name, optional description.
- Name limit: 80 characters.
- Description limit: 500 characters.
- The drop is created only when the task is published.

Payload mapping:
- `No drop`: omit both fields.
- `Existing drop`: include `taskDropId`.
- `Create new drop`: include `taskDropCreate`.

### 10.9 Public Drop Page

Add route in `apps/web`:

```text
/drops/[dropIdOrSlug]
```

Page content:
- Drop name and description.
- Requester identity.
- Active tasks in the drop.
- Recently completed tasks in the drop.
- Subscription form.
- Unsubscribe/status state when wallet/email is known.

The stable identifier should be `id` for v1. Slugs can be displayed and indexed, but id-based routing avoids ownership/slug collision complexity in public URLs.

### 10.10 Task Detail Integration

When a task has `taskDropId`:
- Show the drop name near task metadata.
- Link to the drop page.
- Offer subscription to that drop.

When a task has no drop:
- Do not show Task Drops subscription affordances for that task.

## 11. API Contracts

### 11.1 Create Task With Existing Drop

Request:

```json
{
  "description": "Build a benchmark harness for the CLI",
  "reward": "5000000",
  "duration": 72,
  "mode": "bounty",
  "tags": ["cli", "testing"],
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

### 11.2 Create Task With New Drop

Request:

```json
{
  "description": "Audit the docs install flow",
  "reward": "8000000",
  "duration": 48,
  "mode": "bounty",
  "tags": ["docs", "qa"],
  "taskDropCreate": {
    "name": "Documentation QA Batch",
    "description": "Recurring QA tasks for docs, setup guides, and onboarding flows."
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

### 11.3 Subscribe to Drop

Request:

```json
{
  "taskDropId": "drop_456",
  "email": "worker@example.com",
  "walletAddress": "0x0000000000000000000000000000000000000000",
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

## 12. UX Requirements

### 12.1 Task Creation

The Task Drop control must:
- Default to `No drop`.
- Avoid implying that drops are required.
- Clearly show when subscribers will be notified.
- Prevent selecting drops owned by another requester.
- Preserve current wallet funding and payment flow.

Suggested labels:
- `No drop`
- `Add to existing drop`
- `Create a new drop`

Suggested compact helper copy:
- For no drop: `Publish without subscriber email.`
- For existing drop: `Notify subscribers when this task goes live.`
- For new drop: `Start a reusable drop for this and future tasks.`

### 12.2 Public Drop Page

The drop page should feel like a live work stream, not a marketing landing page:
- Dense task list.
- Clear reward/mode/status scanning.
- Subscription form close to the task list.
- Requester identity and trust cues.

### 12.3 Email

Emails should make the subscription scope obvious:
- Use drop name in subject or top heading.
- Footer says `You are receiving this because you subscribed to {dropName}.`
- Unsubscribe link says `Unsubscribe from this drop`.

## 13. Edge Cases

1. Drop archived between UI selection and publish:
   - Backend rejects with a clear `BAD_REQUEST` error.
2. Drop deleted:
   - Do not hard delete drops in v1. Archive only.
3. Existing global subscriber:
   - Do not send task emails unless they subscribe to a specific drop.
4. Same email subscribes to two drops:
   - Keep two independent rows and two independent unsubscribe states.
5. Task creation succeeds but notification fails:
   - Log and continue.
6. Task creation succeeds but inline drop creation DB step fails:
   - The whole DB transaction fails; use existing task creation recovery process for contract-created but DB-missing tasks.
7. Requester attempts to attach to another requester drop:
   - Reject before contract call/payment settlement where possible.
8. Subscriber signs up after a task is already in the drop:
   - They receive future tasks only in v1.

## 14. Migration Plan

### 14.1 Database Migration

1. Add `task_drops`.
2. Add nullable `tasks.task_drop_id`.
3. Add nullable `task_drop_subscriptions.task_drop_id`.
4. Replace global unique email index with drop-scoped unique index.
5. Keep old subscription rows with `task_drop_id = null` as legacy global subscribers.

### 14.2 Legacy Global Subscribers

Do not automatically enroll global subscribers into every drop.

Recommended migration behavior:
- Keep legacy rows for audit and possible reactivation campaign.
- Stop using `task_drop_id IS NULL` rows for new-task notifications.
- Add an operator-only export or one-time email campaign later asking legacy subscribers to choose drops.

This avoids converting a broad opt-in into many narrower opt-ins without explicit consent.

### 14.3 Rollout Flags

Use an environment or config flag if needed:

```text
TASK_DROPS_SCOPED_NOTIFICATIONS=true
```

Rollout sequence:
1. Deploy schema additions.
2. Deploy backend that supports scoped drops but leaves old global send disabled.
3. Deploy web create-flow controls.
4. Deploy public drop pages and scoped subscribe.
5. Remove or rewrite global Task Drops promo copy.

## 15. Testing Strategy

### 15.1 Backend Unit Tests

Add tests for:
- Creating a task with no drop does not call Task Drops notifier.
- Creating a task with an existing owned drop calls notifier with `taskDropId`.
- Creating a task with an archived drop fails before contract call.
- Creating a task with another owner's drop fails.
- Creating a task with inline `taskDropCreate` creates drop and task attachment.
- Payload with both `taskDropId` and `taskDropCreate` fails schema validation.
- Scoped subscribe allows same email across different drops.
- Scoped subscribe prevents duplicate active email within same drop.
- Scoped unsubscribe deactivates only one drop subscription.
- Notifier selects only subscriptions for the attached drop.
- Notifier idempotency key includes drop id.

### 15.2 Frontend Component Tests

Add tests for:
- Create wizard defaults to no drop.
- Existing drop selection sends `taskDropId`.
- Inline create sends `taskDropCreate`.
- Validation blocks overlong drop names/descriptions.
- Archived or empty drop list state is rendered.
- Task detail shows linked drop when response includes drop metadata.
- Task detail does not show drop subscribe UI when no drop is attached.

### 15.3 Email Tests

Add tests for:
- Welcome email includes drop name and drop page link.
- New-task email includes drop name, reward, mode, tags, and task link.
- Footer language says subscription is for the specific drop.
- Unsubscribe URL includes scoped subscription token.

### 15.4 Integration Tests

Add at least one full backend integration test:
1. Create drop.
2. Subscribe email to drop.
3. Create task attached to drop.
4. Assert one scoped email send.
5. Create task without drop.
6. Assert no Task Drops email send.

## 16. Analytics and Observability

Track:
- `task_drop_created`
- `task_drop_archived`
- `task_attached_to_drop`
- `task_drop_subscription_created`
- `task_drop_subscription_reactivated`
- `task_drop_subscription_unsubscribed`
- `task_drop_notification_sent`
- `task_drop_notification_failed`

Log fields:
- `taskDropId`
- `taskId`
- `ownerAddress`
- `subscriptionId`
- `emailDomain`
- `source`
- `failureReason`

Do not log full email addresses in general logs unless the existing mailer logging policy already permits it.

## 17. Release Plan

### Phase 1: Backend Model

- Add database schema.
- Add shared schemas.
- Add drop router procedures.
- Update task creation schema and router.
- Update notification service to be drop-scoped.
- Update tests.

### Phase 2: Frontend Creation Flow

- Add Task Drop control to create wizard.
- Add requester-owned drop query.
- Add payload mapping and validation.
- Update publish success state.
- Update tests.

### Phase 3: Public Subscription Surfaces

- Add drop page.
- Add task detail drop badge/link.
- Add scoped subscription form.
- Update promo copy to point to specific drops, not a global list.

### Phase 4: Migration and Cleanup

- Disable global new-task emails.
- Preserve legacy global subscriptions as inactive-for-send records.
- Update docs and internal operator notes.
- Monitor email volume, failure rate, unsubscribe rate, and click-through.

## 18. Acceptance Criteria

The feature is complete when:
- A requester can create a drop.
- A requester can attach a new task to an existing drop.
- A requester can create a drop inline while publishing a task.
- A task can be published without any drop.
- Subscribers can subscribe to one drop.
- A new task attached to a drop emails only that drop's active subscribers.
- A new task without a drop sends no Task Drops email.
- Unsubscribing from one drop does not unsubscribe the email from other drops.
- Public task detail pages link to the attached drop.
- Public drop pages list attached tasks and support subscription.
- Existing task creation tests still pass.

## 19. Open Questions

1. Should drop management require wallet signature authentication outside X402 task creation?
2. Should a drop have a public/private visibility state in v1, or only active/archived?
3. Should subscribers receive an immediate digest of existing open tasks when they subscribe?
4. Should requesters be able to attach an already-created task to a drop after publish?
5. Should drop URLs use `id`, owner slug plus drop slug, or both?
6. Should legacy global subscribers receive a one-time email asking them to choose drops?

## 20. Recommended V1 Decisions

1. Use zero-or-one drop per task.
2. Keep drops offchain.
3. Use id-based public drop URLs for v1.
4. Default task creation to no drop.
5. Create inline drops only at publish time.
6. Archive instead of delete.
7. Do not notify legacy global subscribers.
8. Add post-publish attachment only after the creation-time flow is stable.
