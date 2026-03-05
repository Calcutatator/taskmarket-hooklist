# XMTP Production Wiring TDD

## Document Control
- Product: Taskmarket
- Feature: XMTP production runtime wiring for CLI agents
- Status: Draft
- Last updated: 2026-03-03
- PRD: `docs/XMTP_PRODUCTION_WIRING_PRD.md`
- Parent TDD: `docs/XMTP_TDD.md`

## Implementation Status
- [x] PROD-1: Add production XMTP SDK dependency to CLI
- [x] PROD-2: Add runtime signer adapter for XMTP client initialization
- [x] PROD-3: Implement production `createXmtpClient` path in CLI runtime
- [x] PROD-4: Implement production send/listen/query transport adapter
- [x] PROD-5: Add typed transport error mapping and retry behavior
- [x] PROD-6: Add/extend unit tests for production wiring paths
- [x] PROD-7: Add live two-agent smoke test with offline receiver catch-up
- [x] PROD-8: Add rollout runbook notes and operator checks (`docs/XMTP_PRODUCTION_RUNBOOK.md`)

## 1. Goal
Implement production XMTP runtime transport in the CLI so installed agents can exchange real network messages, including offline catch-up, while preserving current control-plane behavior and message envelope contracts.

## 2. Scope
In scope:
1. CLI runtime production transport wiring using XMTP SDK.
2. Keystore-backed signer integration for runtime client initialization.
3. Production path for send/query/listen using existing envelope schema.
4. Unit and smoke tests validating live transport and offline message receipt.

Out of scope:
1. Backend message relay or message-body persistence.
2. Frontend messaging UI.
3. Protocol schema changes beyond compatibility fixes needed for transport.

## 3. Current Gaps to Close
1. `TASKMARKET_XMTP_ENV=production` throws a not-wired error.
2. Runtime uses in-memory `devMessageBus`, which does not support true offline delivery.
3. Existing smoke coverage focuses on backend control plane, not live transport behavior.

## 4. Design Decisions

### DD-1: Keep backend as control plane
1. No backend relay for normal message payloads.
2. Continue using backend for bootstrap/status/resolve/policy/heartbeat.

### DD-2: Isolate SDK interactions behind a thin adapter
1. Keep command handlers unchanged where possible.
2. Hide SDK-specific data types inside runtime library boundary.

### DD-3: Preserve existing envelope contract
1. Continue using `AgentMessageEnvelopeSchema` for encode/decode/validation.
2. Maintain request/response correlation semantics without API surface breakage.

## 5. File-Level Implementation Plan

### 5.1 Dependency and config
1. Update `apps/cli/package.json`:
- Add `@xmtp/node-sdk` in dependencies.
2. Keep existing runtime env controls:
- `TASKMARKET_XMTP_ENV`
- `TASKMARKET_XMTP_DB_DIR`
- `TASKMARKET_XMTP_QUERY_TIMEOUT_MS`

### 5.2 Runtime signer integration
1. Extend CLI runtime helpers to produce signer material from existing keystore flow.
2. Reuse current DEK fetch + decrypt logic; do not duplicate key-management paths.
3. Ensure decrypted key lifetime is scoped and never logged.

### 5.3 `apps/cli/src/lib/xmtp-client.ts`
1. Keep `createDevClient` for development mode.
2. Replace production throw-path with real SDK-backed client creation:
- initialize client with wallet signer
- reuse `existingInboxId`/`existingInstallationId` when available
- persist and return runtime `dbPath`
3. Implement production `sendMessage` on top of SDK publish flow.
4. Implement production `streamMessages` with sync + realtime subscription semantics.
5. Keep existing external interface:
- `XmtpClientSession`
- `sendMessageEnvelope`
- `runQueryWithClient`
- `listenForEnvelopes`

### 5.4 Error and retry behavior
1. Classify transport errors into:
- retryable
- non-retryable
- timeout
2. Apply bounded retry with jittered backoff for retryable send failures.
3. Preserve explicit timeout for `query`.

### 5.5 Backward compatibility
1. Keep CLI command syntax unchanged.
2. Keep backend API calls unchanged for resolve/bootstrap/status.
3. Keep dev fallback available when `TASKMARKET_XMTP_ENV` is not `production`.

## 6. Test Plan

### 6.1 Unit tests (`apps/cli/test/unit`)
1. `xmtp-client.test.ts`:
- production mode initializes SDK-backed client without throw
- production mode surfaces clear error when SDK config is invalid
- send path calls adapter publish
- stream path yields decoded envelopes
2. `xmtp-query.test.ts`:
- correlated response behavior unchanged
- timeout behavior unchanged under production adapter
3. `xmtp-commands.test.ts`:
- command outputs unchanged with production mode stubs

### 6.2 Integration and smoke
1. Add live transport smoke scenario:
- register/bootstrap Agent A and Agent B
- Agent B offline
- Agent A sends message/query
- Agent B starts listener and receives catch-up message
2. Keep existing control-plane smoke (`make smoke xmtp`) passing.

### 6.3 Regression checks
1. Existing CLI non-XMTP commands continue to pass test suite.
2. Existing XMTP dev mode tests remain valid.

## 7. Makefile-Aligned Validation
1. `make test`
2. `make type-check all`
3. `make lint-check all`
4. `make smoke xmtp`
5. `make smoke xmtp-live`

## 8. Rollout Plan
1. Phase 1: merge behind `TASKMARKET_XMTP_ENV=production`.
2. Phase 2: internal two-agent canary with offline delivery checks.
3. Phase 3: broader rollout to selected operators.
4. Phase 4: default production guidance in docs after incident-free window.

## 9. Observability and Runbook Requirements
1. Log transport event type, peer inbox, request IDs, and error category.
2. Record query timeout counts and reconnect attempts.
3. Document remediation for:
- SDK init failures
- repeated send retries
- long-lived stream reconnect loops

## 10. Risks and Mitigations
1. Risk: SDK API drift over time.
- Mitigation: adapter boundary and focused unit tests around adapter contract.

2. Risk: filesystem/db path permission failures.
- Mitigation: early startup checks and explicit error messages with path context.

3. Risk: duplicate processing on reconnect.
- Mitigation: maintain in-memory dedupe plus idempotent handler expectations.

## 11. Acceptance Criteria
1. Production mode no longer throws the current placeholder wiring error.
2. Installed CLI agents can exchange messages over live XMTP transport.
3. Offline receiver catch-up scenario passes smoke validation.
4. Control-plane endpoints and data model remain unchanged for message bodies.
