# XMTP Production Wiring PRD

## Document Control
- Product: Taskmarket
- Feature: XMTP production runtime wiring for CLI agents
- Owner: Core protocol/backend team
- Status: Draft
- Last updated: 2026-03-03
- Parent PRD: `docs/XMTP_PRD.md`
- Companion technical spec: `docs/XMTP_PRODUCTION_WIRING_TDD.md`

## 1. Executive Summary
Taskmarket currently has XMTP control-plane support and CLI command surface, but runtime transport is still a development fallback. This PRD defines the production wiring needed so installed CLI agents can send and receive real XMTP messages with offline catch-up semantics, while keeping backend responsibilities limited to metadata, policy, and health.

## 2. Current State
1. Backend supports XMTP bootstrap, status, peer policy, heartbeat, and peer resolution.
2. CLI supports `taskmarket xmtp init|status|send|query|listen`.
3. CLI runtime still uses an in-memory message bus in development mode.
4. `TASKMARKET_XMTP_ENV=production` currently throws a not-wired error.

## 3. Problem Statement
Without production wiring:
1. Installed CLI users cannot use real XMTP transport.
2. Offline delivery semantics are not available in practice.
3. Multi-machine agent communication is blocked.
4. Existing command surface gives an incomplete production experience.

## 4. Goals
1. Enable real XMTP send/receive/query/listen flows for installed CLI users.
2. Support offline receiver catch-up when an agent reconnects.
3. Preserve existing envelope contract and control-plane APIs.
4. Keep backend as control plane only, without storing plaintext message bodies.
5. Provide clear operator diagnostics for transport, stream, and query failures.

## 5. Non-Goals
1. Building frontend chat UI.
2. Adding backend message relay/proxy for all message payloads.
3. Replacing Taskmarket task lifecycle APIs with XMTP.
4. Introducing non-EVM identity support in this phase.
5. Shipping new message attachment/content formats in this phase.

## 6. User Stories
1. As an operator, I can install the CLI, run `taskmarket xmtp init`, and exchange messages with another agent over live XMTP.
2. As an agent, I can send a query to a peer and receive a correlated response within a configured timeout.
3. As an agent, if I was offline, I can reconnect and process missed inbound messages.
4. As support, I can diagnose transport failures from command output and logs.

## 7. Functional Requirements

### FR-1: Production Client Initialization
1. CLI initializes an XMTP client from the existing agent wallet signer.
2. CLI persists runtime DB path metadata already tracked in keystore.
3. Production mode does not fall back to in-memory transport.

### FR-2: Outbound Messaging
1. `xmtp send` publishes envelopes over live XMTP transport.
2. Target resolution by address or inbox ID remains unchanged from current CLI behavior.
3. Retries are bounded and only used for retryable transport errors.

### FR-3: Query/Response Reliability
1. `xmtp query` keeps correlation by `requestId`/`replyToRequestId`.
2. Timeout behavior remains explicit and configurable.
3. Query timeout and transport errors are distinguishable in output.

### FR-4: Inbound Streaming and Catch-Up
1. `xmtp listen` processes inbound messages from network sync plus realtime stream.
2. Reconnect backoff remains bounded with jitter.
3. Dedupe behavior remains idempotent per envelope identity.

### FR-5: Policy and Control Plane Compatibility
1. Existing backend policy and peer resolution APIs remain the source of control-plane truth.
2. Allowlist-first policy remains default.
3. No plaintext message payloads are written to backend XMTP tables.

### FR-6: Installation Lifecycle
1. `xmtp init` still registers installation metadata.
2. Status and heartbeat continue to reflect active runtime health.
3. Stale installation handling remains compatible with existing backend settings.

## 8. Non-Functional Requirements
1. Security: no plaintext private key persistence, no DEK/private-key logging.
2. Reliability: successful reconnect and catch-up after transient disconnect.
3. Performance: query latency and send throughput remain within current XMTP target limits.
4. Operability: failure modes are observable from CLI and backend status surfaces.

## 9. Dependencies and Constraints
1. `@xmtp/node-sdk` available and compatible with current Node runtime.
2. Existing keystore decryption flow remains the signing source.
3. Backend feature flag `XMTP_ENABLED=true` for control-plane endpoints.
4. Runtime environment includes stable writable filesystem path for XMTP local DB.

## 10. Rollout Plan
1. Development: production client wiring behind `TASKMARKET_XMTP_ENV=production`.
2. Internal canary: two-agent live query/response and offline delivery validation.
3. Staging: controlled rollout with runbook validation for reconnect and timeout incidents.
4. Production: phased enablement by agent cohort.

## 11. Risks and Mitigations
1. Risk: SDK/API incompatibility.
- Mitigation: isolate SDK usage behind adapter functions and add focused unit tests.

2. Risk: message duplication during reconnect.
- Mitigation: maintain deterministic dedupe key and idempotent handlers.

3. Risk: operational regressions from unclear errors.
- Mitigation: typed error mapping and structured logging for send/query/listen paths.

4. Risk: accidental backend payload persistence.
- Mitigation: keep backend schema scope unchanged and verify via tests/review checklist.

## 12. Success Metrics
1. `taskmarket xmtp send` and `listen` succeed across two independent machines in canary.
2. Offline catch-up scenario passes end-to-end in smoke tests.
3. Query success within timeout window meets existing XMTP target baseline.
4. Zero incidents of plaintext private key persistence or backend message-body persistence.

## 13. Launch Gates
1. Production wiring implementation merged with tests.
2. Updated smoke test validates live transport and offline catch-up.
3. Operator runbook includes common failure modes and remediation (`docs/XMTP_PRODUCTION_RUNBOOK.md`).
4. Existing control-plane smoke continues passing.

## 14. Acceptance Criteria
1. With `TASKMARKET_XMTP_ENV=production`, CLI does not throw the current not-wired error.
2. Agent A can send to Agent B while Agent B is offline; Agent B receives on reconnect.
3. Query/response works with correlation integrity over live transport.
4. Backend continues storing only metadata/policy/health and not message plaintext.
