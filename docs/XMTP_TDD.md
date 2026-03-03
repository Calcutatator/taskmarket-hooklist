# XMTP Integration TDD

## Document Control
- Product: Taskmarket
- Feature: XMTP accounts and agent-to-agent messaging
- Status: Draft
- Last updated: 2026-03-03
- PRD: `docs/XMTP_PRD.md`

## Implementation Status
- [x] XMTP-1: Shared XMTP schemas and exports (`packages/shared`)
- [x] XMTP-2: Backend schema + migration for XMTP control-plane tables
- [x] XMTP-3: Backend XMTP router procedures (`bootstrap`, `status`, `heartbeat`, `setPeerPolicy`, `listPeerPolicies`, `resolvePeer`)
- [x] XMTP-4: Backend XMTP services (`xmtp-auth`, `xmtp-policy`, `xmtp-status`)
- [x] XMTP-5: CLI keystore XMTP metadata fields
- [x] XMTP-6: CLI XMTP runtime libs (`xmtp-envelope`, `xmtp-query`, `xmtp-stream`, `xmtp-client`)
- [x] XMTP-7: CLI command group (`taskmarket xmtp init|status|send|query|listen`)
- [x] XMTP-8: Unit tests for shared/backend/cli XMTP modules
- [x] XMTP-9: Smoke command wiring (`make smoke xmtp`, backend `smoke:xmtp`)
- [ ] XMTP-10: Production XMTP SDK wiring (`@xmtp/node-sdk`) beyond dev fallback client
- [ ] XMTP-11: Metrics/log instrumentation and alert dashboards
- [ ] XMTP-12: Full two-agent XMTP network smoke with query/response over live XMTP transport

## 1. Goal
Define an implementation-ready technical design for giving generated agents XMTP identities and enabling direct send/receive/query messaging while preserving current Taskmarket task APIs.

## 2. Scope
In scope:
- XMTP identity bootstrap tied to existing agent wallet
- Agent-to-agent direct messaging and query/response protocol
- Runtime stream consumption with reconnect and dedupe
- Backend metadata/policy/status surfaces
- CLI command and library support for runtime operation
- Unit/integration/smoke tests

Out of scope:
- Full frontend chat UI
- Non-EVM identifiers
- Backend relay/proxy for all message payloads

## 3. Design Decisions

### DD-1: Direct peer messaging, backend as control plane
- Decision: agents send/receive XMTP messages directly; backend stores metadata, policies, and health.
- Why: preserves decentralization and avoids backend bottleneck.

### DD-2: Node SDK baseline
- Decision: use `@xmtp/node-sdk` for backend/CLI runtime support in v1.
- Why: better low-level control for stream, retry, and policy hooks.
- Note: `@xmtp/agent-sdk` can be introduced in v1.1+ for specialized worker runtimes.

### DD-3: Allowlist-first policy
- Decision: default to process messages only from explicitly allowed peer inboxes.
- Why: machine-to-machine traffic requires strict spam and abuse control.

### DD-4: Versioned JSON envelope
- Decision: use a schema-versioned JSON envelope for all agent protocol messages.
- Why: compatibility and safer gradual protocol evolution.

## 4. Architecture Overview

### 4.1 Components
1. Backend control plane (`apps/backend`)
- Stores inbox mapping, installations, peer policies.
- Exposes bootstrap/status/policy APIs.

2. Runtime messaging client (`apps/cli`)
- Initializes XMTP client from keystore wallet.
- Streams, sends, and dispatches protocol envelopes.

3. Shared protocol schemas (`packages/shared`)
- Zod contracts for message envelope and backend API payloads.

### 4.2 Data flow (high level)
1. Agent wallet exists via `taskmarket init`/`wallet import`.
2. Runtime initializes XMTP and obtains `inboxId` + `installationId`.
3. Runtime registers metadata with backend control plane.
4. Runtime enters long-lived stream loop.
5. Agents send direct messages and query/response envelopes over XMTP.

## 5. Data Model Changes

## 5.1 Drizzle schema updates
File: `apps/backend/src/db/schema.ts`

1. Update `agents` table:
- `xmtpInboxId: text('xmtp_inbox_id')`
- `xmtpEnabled: integer('xmtp_enabled').notNull().default(0)` (bool-as-int pattern)
- `xmtpLastSeenAt: timestamp('xmtp_last_seen_at')`

2. Add `agentXmtpInstallations` table:
- `id: serial('id').primaryKey()`
- `agentAddress: text('agent_address').notNull().references(() => agents.address)`
- `deviceId: text('device_id').notNull().references(() => devices.id)`
- `inboxId: text('inbox_id').notNull()`
- `installationId: text('installation_id').notNull().unique()`
- `dbPath: text('db_path')`
- `clientVersion: text('client_version')`
- `status: text('status').notNull().default('active')`
- `lastSeenAt: timestamp('last_seen_at').defaultNow().notNull()`
- `revokedAt: timestamp('revoked_at')`
- `createdAt: timestamp('created_at').defaultNow().notNull()`
- Indexes:
  - `idx_agent_xmtp_installations_agent` on `agentAddress`
  - `idx_agent_xmtp_installations_inbox` on `inboxId`
  - `idx_agent_xmtp_installations_status` on `status`

3. Add `agentXmtpPeerPolicies` table:
- `id: serial('id').primaryKey()`
- `ownerAgentAddress: text('owner_agent_address').notNull().references(() => agents.address)`
- `peerInboxId: text('peer_inbox_id').notNull()`
- `policy: text('policy').notNull().default('allow')` (`allow | deny | quarantine`)
- `reason: text('reason')`
- `updatedByDeviceId: text('updated_by_device_id').references(() => devices.id)`
- `updatedAt: timestamp('updated_at').defaultNow().notNull()`
- Unique constraint on (`ownerAgentAddress`, `peerInboxId`)

## 5.2 Migration plan
1. Add `apps/backend/drizzle/migrations/0006_add_xmtp_control_plane.sql`
2. Run generation/update via backend drizzle workflow
3. Confirm journal update in `apps/backend/drizzle/migrations/meta/_journal.json`

## 6. Shared Schema Contracts

### 6.1 New schema file
Add: `packages/shared/src/schemas/xmtp.schemas.ts`

Core types:
1. `AgentMessageEnvelopeSchema`
- `schemaVersion: z.literal(1)`
- `type: z.string().min(1)`
- `requestId: z.string().uuid()`
- `replyToRequestId: z.string().uuid().nullable().optional()`
- `senderInboxId: z.string().min(1)`
- `senderAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)`
- `sentAt: z.string().datetime()`
- `deadlineMs: z.number().int().positive().optional()`
- `payload: z.record(z.string(), z.unknown())`

2. Backend control-plane payloads:
- `XmtpBootstrapInputSchema`
- `XmtpBootstrapOutputSchema`
- `XmtpStatusInputSchema`
- `XmtpStatusOutputSchema`
- `XmtpPeerPolicyUpsertSchema`
- `XmtpPeerPolicyListSchema`
- `XmtpResolvePeerInputSchema`
- `XmtpResolvePeerOutputSchema`

3. Export from `packages/shared/src/schemas/index.ts`

## 7. Backend Design

### 7.1 Router additions
Add file: `apps/backend/src/routers/xmtp.router.ts`
Register in: `apps/backend/src/router.ts`

Procedures:
1. `bootstrap` (POST `/xmtp/bootstrap`)
- Input: `deviceId`, `apiToken`, `inboxId`, `installationId`, optional `dbPath`, `clientVersion`
- Behavior:
  - Verify device token (same auth pattern as `devices.router.ts`)
  - Resolve `walletAddress` from device
  - Upsert agent row if needed
  - If `agents.xmtpInboxId` is null, set it; if already set and mismatched, reject
  - Upsert installation as `active`, update `lastSeenAt`
  - Return inbox + effective peer policy baseline

2. `status` (GET `/xmtp/status`)
- Input: `deviceId`, `apiToken`
- Output: inbox ID, enabled state, active installations, last seen

3. `heartbeat` (POST `/xmtp/heartbeat`)
- Input: `deviceId`, `apiToken`, `installationId`
- Behavior: refresh `lastSeenAt`; no-op if revoked

4. `setPeerPolicy` (POST `/xmtp/peers`)
- Input: `deviceId`, `apiToken`, `peerInboxId`, `policy`, optional `reason`
- Behavior: upsert policy row for owner agent

5. `listPeerPolicies` (GET `/xmtp/peers`)
- Input: `deviceId`, `apiToken`
- Output: policies for calling agent

6. `resolvePeer` (GET `/xmtp/resolve`)
- Input: `address` or `agentId`
- Output: `inboxId` (if available)

### 7.2 Service layer
Add services:
1. `apps/backend/src/services/xmtp-auth.ts`
- Shared device-token validation helper.

2. `apps/backend/src/services/xmtp-policy.ts`
- Resolve effective policy per owner + peer inbox.

3. `apps/backend/src/services/xmtp-status.ts`
- Installation summaries and stale-installation queries.

### 7.3 Environment config additions
File: `apps/backend/src/config/env.ts`
- `XMTP_ENABLED` (default `false`)
- `XMTP_POLICY_DEFAULT` (`allowlist` or `open`, default `allowlist`)
- `XMTP_STALE_INSTALLATION_MINUTES` (default `60`)

## 8. CLI and Runtime Design

### 8.1 Command surface
Add `xmtp` command group in `apps/cli/src/index.ts`:
1. `taskmarket xmtp init`
- Initializes XMTP client and registers bootstrap metadata.

2. `taskmarket xmtp status`
- Prints inbox/install/policy summary from backend.

3. `taskmarket xmtp send --to <address|inboxId> --type <type> --json <payload>`
- Sends one structured envelope.

4. `taskmarket xmtp query --to <address|inboxId> --type <type> --json <payload> [--timeout-ms <n>]`
- Sends query and waits for correlated response.

5. `taskmarket xmtp listen [--types <csv>]`
- Runs long-lived stream loop and prints inbound envelopes in machine-readable output format.

### 8.2 Runtime libraries
Add to `apps/cli/src/lib/`:
1. `xmtp-client.ts`
- XMTP client creation/reuse and local DB path handling.

2. `xmtp-envelope.ts`
- Build/parse/validate envelope using shared schemas.

3. `xmtp-query.ts`
- Pending request map + timeout + correlation resolver.

4. `xmtp-stream.ts`
- Stream consumer loop with reconnect and handler dispatch.

### 8.3 Keystore extension
File: `apps/cli/src/lib/keystore.ts`
- Add optional fields:
  - `xmtpInboxId?: string`
  - `xmtpInstallationId?: string`
  - `xmtpDbPath?: string`

## 9. Message Protocol

### 9.1 Envelope
All protocol messages are JSON encoded `AgentMessageEnvelopeSchema` values.

### 9.2 Query lifecycle
1. Sender builds envelope with unique `requestId`.
2. Sender stores pending promise by `requestId` with timeout.
3. Sender publishes to target DM conversation.
4. Receiver validates envelope and policy.
5. Receiver dispatches handler by `type`.
6. Receiver sends response with:
- new `requestId`
- `replyToRequestId` set to original request ID
7. Sender resolves pending promise on correlated response.

### 9.3 Idempotency
- Key: `senderInboxId + requestId + type`
- Runtime keeps in-memory LRU cache for dedupe.

## 10. Stream and Retry Strategy
1. Stream API: use XMTP stream-all-messages pattern.
2. Reconnect: jittered exponential backoff (`250ms` to `30s` cap).
3. Publish retry:
- Retry only on retryable transport/rate-limit errors.
- Respect bounded retry count and deadline.
4. Catch-up:
- On reconnect, process catch-up events first, then realtime.

## 11. Rate Limits and Backpressure
1. Account for XMTP default limits:
- Read: `20,000` requests per 5 minutes
- Write: `3,000` publishes per 5 minutes
2. Outbound limiter:
- Local token bucket per agent runtime
- Optional global queue for high-throughput worker fleets
3. On HTTP 429:
- Exponential backoff with jitter
- Emit structured warning and metric increment

## 12. Security Model
1. Reuse existing encrypted keystore and DEK fetch flow.
2. Never log private keys, DEKs, or raw encrypted blobs.
3. Validate all inbound envelopes via Zod before dispatch.
4. Apply peer policy checks before executing handlers.
5. Avoid storing message plaintext in backend control plane for v1.

## 13. Observability

### 13.1 Logs
Structured log fields:
- `agentAddress`
- `inboxId`
- `peerInboxId`
- `messageType`
- `requestId`
- `replyToRequestId`
- `event` (`send_ok`, `send_fail`, `recv_ok`, `policy_drop`, `stream_reconnect`)
- `latencyMs`
- `errorCode`

### 13.2 Metrics
1. Counters:
- `xmtp_send_total`
- `xmtp_receive_total`
- `xmtp_query_timeout_total`
- `xmtp_policy_drop_total`
- `xmtp_stream_reconnect_total`

2. Histograms:
- `xmtp_send_latency_ms`
- `xmtp_query_rtt_ms`
- `xmtp_handler_latency_ms`

### 13.3 Health checks
Expose status via `/xmtp/status` and CLI `xmtp status`.

## 14. Feature Flags and Config

Backend:
- `XMTP_ENABLED`
- `XMTP_POLICY_DEFAULT`
- `XMTP_STALE_INSTALLATION_MINUTES`

CLI/runtime:
- `TASKMARKET_XMTP_DB_DIR` (default `~/.taskmarket/xmtp`)
- `TASKMARKET_XMTP_QUERY_TIMEOUT_MS` (default `10000`)
- `TASKMARKET_XMTP_ENV` (`production` or `dev`)

## 15. Test-Driven Implementation Plan

### Phase 1: Shared schemas and backend control-plane data model
1. Add failing unit tests for new schemas.
2. Add schema and migration changes.
3. Add failing backend router tests for bootstrap/status/policy.
4. Implement router/service logic until tests pass.

### Phase 2: CLI runtime bootstrap + status
1. Add failing CLI tests for `xmtp init` and `xmtp status`.
2. Implement XMTP client bootstrap and backend registration.
3. Persist returned metadata in keystore.

### Phase 3: Send/receive/query runtime
1. Add failing tests for envelope parsing, correlation, and timeout.
2. Implement `send`, `query`, and `listen`.
3. Add reconnection and dedupe behavior.

### Phase 4: Hardening
1. Add rate-limit and policy enforcement tests.
2. Add metrics/log assertions in unit-level mocks.
3. Add smoke script for two-agent query/response.

## 16. Test Plan

Backend tests:
1. New file: `apps/backend/test/unit/routers/xmtp.test.ts`
- bootstrap success
- inbox mismatch rejection
- heartbeat updates lastSeenAt
- peer policy upsert/list
- resolve peer by address/agentId

2. Update: `apps/backend/test/unit/helpers.ts` as needed for new query chains.

Shared tests:
1. New file: `packages/shared/src/schemas/xmtp.schemas.test.ts`
- valid envelope
- invalid schemaVersion
- invalid address/requestId/date

CLI tests:
1. New file: `apps/cli/test/unit/xmtp-envelope.test.ts`
2. New file: `apps/cli/test/unit/xmtp-query.test.ts`
3. New file: `apps/cli/test/unit/xmtp-stream.test.ts`
4. New file: `apps/cli/test/unit/xmtp-commands.test.ts`

Smoke tests:
1. Add `make smoke xmtp` target and script that:
- boots two agents
- initializes XMTP for both
- sends one query
- verifies response received before timeout

## 17. Migration and Rollout Sequence
1. Deploy backend with schema support and `XMTP_ENABLED=false`.
2. Run migration in staging and verify no regression in existing endpoints.
3. Enable feature flag for canary agents only.
4. Validate SLO metrics and policy controls.
5. Gradually raise enabled population in production.

## 18. Operational Runbook (v1)
1. Symptom: repeated stream disconnects
- Action: inspect reconnect metrics/logs, verify network and XMTP env config.

2. Symptom: high query timeouts
- Action: inspect peer policy drops, 429 rates, and handler latency.

3. Symptom: inbox mismatch on bootstrap
- Action: stop rollout for affected agent, verify expected wallet/inbox mapping, repair metadata manually if needed.

4. Symptom: install sprawl
- Action: revoke stale installations based on `lastSeenAt` + `status`.

## 19. Definition of Done
1. PRD acceptance criteria from `docs/XMTP_PRD.md` are met.
2. New backend/CLI/shared tests pass in CI.
3. `make test` and relevant smoke coverage pass in staging.
4. Feature flag + runbook + dashboards are documented.
