# Taskmarket ChatGPT App
## Product Requirements Document (PRD) + Technical Design Document (TDD)

Document owner: Product + Backend  
Last updated: March 3, 2026  
Status: Decision-locked for internal alpha

## 1. Executive Summary

Taskmarket will launch a ChatGPT App using the OpenAI Apps SDK so users can discover work, manage tasks, and execute marketplace actions directly inside ChatGPT with structured tools and optional embedded UI components.

The app will integrate with the existing Taskmarket backend (`apps/backend`) and preserve current marketplace rules:
- Task lifecycle and permissions enforced in existing routers/services.
- Onchain settlement and identity flows preserved.
- X402 payment requirements preserved, with ChatGPT-compatible orchestration.
- Service architecture kept channel-agnostic so other chat applications can integrate through the same orchestration layer.

This document defines:
- Product goals, personas, requirements, success criteria.
- End-to-end technical architecture and implementation plan.
- Test-first strategy and acceptance criteria for release.

## 2. Product Context

### 2.1 Problem Statement

Today Taskmarket supports:
- CLI-first workflows for agents.
- Web frontend workflows for human users.
- API/OpenAPI access for custom integrations.

But there is no native ChatGPT experience for:
- Conversational discovery of tasks.
- Guided execution of task workflows.
- In-chat orchestration of complex, mode-specific actions.

Users must leave ChatGPT to complete work, causing drop-off and higher operational friction.

### 2.2 Opportunity

The Apps SDK enables:
- Direct tool invocation in ChatGPT.
- Rich UI components for multi-step actions.
- Stateful sessions for guided flows.

Taskmarket can become a first-class conversational marketplace where requesters and workers operate with reduced friction while still using the existing secure backend and smart-contract primitives.

## 3. Goals and Non-Goals

### 3.1 Goals

1. Enable full marketplace read workflows in ChatGPT:
   - Browse and filter tasks, inspect details, view submissions/pitches/bids.
2. Enable high-confidence write workflows with strong validation:
   - Create, claim, bid, pitch, submit, accept, rate, and select winner/worker.
3. Preserve role and payment integrity:
   - Keep existing backend permission model and X402/onchain guarantees.
4. Deliver robust observability and safety:
   - Audit logs, failure tracing, abuse controls, rollback strategy.
5. Deliver fully executable paid actions in alpha (not read-only).
6. Keep abstraction tight for multi-channel support:
   - ChatGPT first, but portable to other chat applications with minimal adapter work.

### 3.2 Non-Goals (Initial Release)

1. Replacing CLI or web app entirely.
2. Rewriting core backend routers or smart contract logic.
3. Building a new independent marketplace state machine.
4. Supporting every advanced admin operation in v1.

## 4. Personas and Jobs-To-Be-Done

### 4.1 Requester Persona

Needs to:
- Post work quickly.
- Monitor incoming submissions/pitches/bids.
- Select and pay the right worker.
- Rate outcomes for reputation.

Pain points today:
- Context switching between tools.
- Manual filtering and status tracking.

### 4.2 Worker Persona

Needs to:
- Discover tasks matching skills/reward constraints.
- Execute mode-specific participation correctly.
- Track what action is required next.

Pain points today:
- Remembering mode-specific rules.
- Finding high-quality opportunities quickly.

### 4.3 Operator Persona

Needs to:
- Ensure secure, compliant, observable operation.
- Diagnose failed flows quickly.
- Control rollout risk.

## 5. Success Metrics

### 5.1 Product KPIs

1. Activation:
   - Percent of connected users who run at least one successful tool call.
2. Marketplace engagement:
   - Tasks viewed per active ChatGPT user.
   - Conversion from task view to mode-valid participation action.
3. Transaction completion:
   - End-to-end completion rate for create -> submit -> accept -> rate.
4. Quality:
   - Error rate per tool.
   - Recovery rate after first failure.

### 5.2 Reliability KPIs

1. Tool success rate >= 99.0% for read tools.
2. Tool success rate >= 97.0% for write tools (excluding user-rejected signing/payment).
3. p95 latency:
   - Read tools: <= 2.5s
   - Write tools: <= 5s (excluding long chain confirmations)

## 6. Scope by Release Phase

### 6.1 Phase 1: Internal Alpha (target: within a few days)

- Fully executable paid actions for all five modes (`bounty`, `claim`, `pitch`, `benchmark`, `auction`).
- Anonymous read access for discovery and task inspection.
- Authenticated setup flow provisions a managed wallet automatically.
- Single linked wallet per authenticated user.
- File upload support for submission flows.
- Server wallet flow preserved for backend contract execution and current payment cost behavior.

### 6.2 Phase 2: Hardening

- Reliability improvements, richer error recovery, and stronger operations tooling.
- Better guided UX, stateful follow-ups, and workflow completion nudges.
- Multi-channel adapter refinement for non-ChatGPT integrations.

### 6.3 Phase 3: Scale + Ecosystem

- Additional chat-channel integrations through the same core service abstractions.
- Deeper recommendation and automation features.

## 7. Functional Requirements

### 7.1 Account Linking and Access Control

FR-001: Anonymous users may run read-only tools; privileged actions require authenticated setup that creates and links a managed wallet.  
FR-002: Role-sensitive actions must enforce requester/worker constraints exactly as backend routers do.  
FR-003: Unauthorized calls must return deterministic, user-actionable errors.  
FR-004: The system must support a single linked wallet per authenticated user in alpha.

### 7.2 Discovery and Read Workflows

FR-010: Users must be able to list tasks with filters (status, mode, tags, reward constraints).  
FR-011: Users must be able to inspect full task details including pending next actions.  
FR-012: Users must be able to list submissions, pitches, bids, proofs, and feedback context for a task.  
FR-013: Users must be able to inspect agent stats and identity status.

### 7.3 Task Creation and Participation

FR-020: Requesters must create tasks with mode-aware validation.  
FR-021: Workers must claim claim-mode tasks.  
FR-022: Workers must submit pitches for pitch mode and bids for auction mode.  
FR-023: Workers must submit work/proof where permitted by mode and status.  
FR-024: Requesters must select worker/winner where mode requires it.
FR-025: Submission flows must support file uploads in chat UX.

### 7.4 Task Settlement and Reputation

FR-030: Requesters must accept valid submissions for eligible task states.  
FR-031: Requesters must rate accepted work within current rating constraints.  
FR-032: All settlement and rating flows must preserve existing onchain/backend behavior.

### 7.5 Payments

FR-040: Payment-required actions must clearly surface cost and intent before execution.  
FR-041: Current server wallet flow and existing X402 behavior/costs must be preserved.  
FR-042: Payment and signing failures must return structured remediation steps.

### 7.6 State and UX

FR-050: Users must get context-aware next steps after every tool action.  
FR-051: Session state must support multi-step flows across turns safely.  
FR-052: Tool outputs must be concise for model consumption and rich enough for UI hydration.

### 7.7 Operations and Governance

FR-060: Every tool call must be audit logged with request/result metadata.  
FR-061: Full request/response payloads must be captured in audit logs for alpha diagnostics.  
FR-062: Role must be inferred dynamically per action (aligned with existing CLI semantics).

## 8. Non-Functional Requirements

NFR-001: Security-first defaults for auth, signing, and sensitive metadata handling with minimal policy overhead in alpha.  
NFR-002: Backward compatibility with existing backend API contracts.  
NFR-003: Deterministic schema validation at all boundaries.  
NFR-004: Full observability for success, failures, payload traces, and p95 latency.  
NFR-005: Environment parity across dev/staging/prod for app connector and MCP transport across Base mainnet and Base Sepolia.

## 9. End-to-End User Journeys

### 9.1 Requester Journey (Bounty Example)

1. User can browse anonymously, or authenticate and run setup to provision/link a managed wallet.
2. User asks ChatGPT to create a bounty task.
3. App validates input, previews cost, executes creation flow.
4. User asks for submissions for the task.
5. User selects worker and accepts submission.
6. User rates worker and confirms completion.

### 9.2 Worker Journey (Auction Example)

1. User asks for open auction tasks under reward threshold.
2. User inspects task details and bid deadline.
3. User places bid with the app-managed wallet flow and current payment behavior.
4. User checks winner status after deadline.
5. If selected, user submits final work.

## 10. Technical Design (TDD)

## 10.1 Architecture Overview

Add a new service:
- `apps/chatgpt-app`

Responsibilities:
- Expose Apps SDK-compatible MCP server.
- Register tools/resources/components.
- Perform auth/account linking checks.
- Orchestrate calls to existing Taskmarket backend APIs.
- Normalize errors and produce model-friendly outputs.
- Expose channel-agnostic orchestration interfaces so non-ChatGPT channels can reuse core logic.

Existing backend remains source of truth:
- Task lifecycle: `apps/backend/src/routers/*`
- Payment/X402 logic: `apps/backend/src/middleware/x402.ts`
- Identity/wallet/task state: existing DB schema and contract services.

### 10.1.1 High-level Flow

1. ChatGPT invokes tool on MCP server.
2. MCP server validates input and auth context.
3. MCP server calls Taskmarket backend endpoint(s).
4. Backend enforces permissions/state transitions.
5. MCP server formats concise result + optional UI metadata.
6. ChatGPT renders response and component.

## 10.2 Proposed `apps/chatgpt-app` Structure

```text
apps/chatgpt-app/
├── src/
│   ├── server.ts                  # Apps SDK server bootstrap
│   ├── transport/
│   │   └── mcp.ts                 # Streamable HTTP transport setup
│   ├── auth/
│   │   ├── resolver.ts            # map chatgpt identity -> taskmarket account
│   │   └── guards.ts              # role and auth guard utilities
│   ├── channels/
│   │   ├── chatgpt.ts             # ChatGPT channel adapter
│   │   └── base.ts                # shared channel abstraction contract
│   ├── tools/
│   │   ├── tasks.ts
│   │   ├── submissions.ts
│   │   ├── pitches.ts
│   │   ├── bids.ts
│   │   ├── identity.ts
│   │   └── wallet.ts
│   ├── resources/
│   │   ├── task-list-widget.ts
│   │   ├── task-detail-widget.ts
│   │   └── payment-widget.ts
│   ├── adapters/
│   │   └── taskmarket-api.ts      # typed HTTP adapter to apps/backend API
│   ├── schemas/
│   │   └── tools.ts               # zod input/output schemas
│   ├── state/
│   │   └── session.ts             # ephemeral flow state manager
│   └── observability/
│       ├── logger.ts
│       └── metrics.ts
├── package.json
└── tsconfig.json
```

## 10.3 API Integration Strategy

Primary integration: existing OpenAPI routes under `/api`.

Key endpoints mapped from current backend:
- `GET /api/tasks`
- `GET /api/tasks/{taskId}`
- `POST /api/tasks`
- `POST /api/tasks/{taskId}/accept`
- `POST /api/tasks/{taskId}/rate`
- `POST /api/tasks/{taskId}/claim`
- `POST /api/tasks/{taskId}/pitches`
- `POST /api/tasks/{taskId}/pitches/select`
- `POST /api/tasks/{taskId}/bids`
- `POST /api/tasks/{taskId}/bids/select-winner`
- `POST /api/tasks/{taskId}/submissions`
- `GET /api/tasks/{taskId}/submissions`
- `GET /api/identity/status`
- `GET /api/wallet/balance`

Design principle:
- No duplicate business logic in `apps/chatgpt-app`.
- All state transitions remain in backend routers/services.

## 10.4 Tool Catalog (Initial)

### 10.4.1 Read Tools

1. `list_tasks`
2. `get_task`
3. `list_submissions`
4. `list_pitches`
5. `list_bids`
6. `agent_stats`
7. `identity_status`
8. `wallet_balance`

### 10.4.2 Action Tools (Alpha Required)

1. `create_task`
2. `claim_task`
3. `submit_pitch`
4. `select_worker`
5. `submit_bid`
6. `select_winner`
7. `submit_work`
8. `accept_submission`
9. `rate_worker`

### 10.4.3 Preparation/Guardrail Tools

1. `prepare_create_task`
2. `prepare_accept_submission`
3. `prepare_rate_worker`

These return:
- Required fields.
- Estimated payment requirement.
- Eligibility check summary.
- Recommended next command/action.

## 10.5 Payment and Signing Design

Constraint:
- Existing write endpoints depend on X402 signatures and payer derivation.

Design:
1. Use managed wallet provisioning during authenticated setup (single wallet per user).
2. Use server-side signing/payment orchestration aligned with current server wallet flow.
3. Preserve backend-side verification, payer enforcement, and current endpoint cost behavior.
4. Retain payment intent records for observability and recovery.

Fallback:
- If signing flow unavailable, return explicit redirect guidance to CLI/web completion path.

## 10.6 State Management

State layers:
1. Stateless tool output for deterministic operations.
2. Ephemeral session state for multi-step flows (e.g., create -> confirm -> execute).
3. Persistent audit/intent records for recovery and observability.

Session object minimal fields:
- `sessionId`
- `chatgptUserId`
- `linkedWallet`
- `activeTaskId`
- `activeFlow`
- `lastTool`
- `pendingIntentId`

## 10.7 Data Model Additions (Backend DB)

Add tables in backend schema:

1. `chatgpt_accounts`
   - `id` (pk)
   - `chatgpt_user_id` (unique)
   - `wallet_address`
   - `wallet_provider` (e.g., `managed`)
   - `wallet_key_ref` (encrypted key reference)
   - `created_at`
   - `updated_at`

2. `chatgpt_tool_audit`
   - `id` (pk)
   - `chatgpt_user_id`
   - `tool_name`
   - `request_json` (full payload)
   - `response_json` (full payload)
   - `success`
   - `latency_ms`
   - `created_at`

3. `payment_intents`
   - `id` (pk)
   - `chatgpt_user_id`
   - `wallet_address`
   - `action`
   - `amount_base_units`
   - `status` (`pending`, `prepared`, `submitted`, `settled`, `failed`, `expired`)
   - `payload_json`
   - `error_message`
   - `created_at`
   - `updated_at`

## 10.8 Security and Privacy Design

1. Validate all tool inputs with Zod schemas.
2. Enforce role checks server-side before calling mutating endpoints.
3. Never expose secrets in tool text output.
4. Use hidden metadata only for UI hydration fields that should not be model-exposed.
5. Add replay protection in intent/signature flows.
6. Keep audit logs immutable for incident investigation.

## 10.9 Error Model

Error classes returned to ChatGPT:
- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `FORBIDDEN_ROLE`
- `VALIDATION_ERROR`
- `PAYMENT_REQUIRED`
- `PAYMENT_FAILED`
- `NOT_FOUND`
- `CONFLICT_STATE`
- `INTERNAL_ERROR`

Every error must include:
- `code`
- `message`
- `actionableNextStep`
- `retryable` boolean

## 10.10 Observability

Track:
- Tool invocation counts and success rates.
- Latency percentiles by tool.
- Failure reasons by code.
- Payment intent funnel conversion.
- Session abandonment points.
- Full request/response payload capture for alpha diagnostics.

Primary SLO signal:
- p95 latency by tool class (reads vs writes), trended continuously.

## 10.11 Deployment

Environments:
- Local
- Staging
- Production
- Base Sepolia
- Base Mainnet

Requirements:
1. Public HTTPS endpoint reachable by ChatGPT connector.
2. Environment variables for backend base URL, auth keys, and telemetry.
3. Safe rollout with feature flags and gradual tool enablement.

## 10.12 Account Linking Recommendation

Recommended approach for alpha:
1. Map authenticated channel user ID to a managed Taskmarket wallet in `chatgpt_accounts`.
2. Auto-provision wallet during setup (first privileged action or explicit setup tool).
3. Store only encrypted key reference material (`wallet_key_ref`) and never return raw private keys.
4. Keep linking model provider-agnostic (`channel`, `channel_user_id`) so other chat channels can plug in later.

## 11. Test-Driven Development Plan

## 11.1 Testing Philosophy

Follow strict test-first workflow:
1. Define failing test for each requirement.
2. Implement minimal code to pass.
3. Refactor while preserving test pass.
4. Expand integration and contract coverage before release.

## 11.2 Test Layers

1. Unit tests
   - Tool schema validation.
   - Auth guards.
   - Error mapping.
   - Session utilities.
2. Integration tests
   - MCP tool -> backend adapter -> mocked backend.
   - Payment intent lifecycle.
   - Managed wallet setup, auth challenge, and recovery flow.
3. End-to-end tests
   - ChatGPT app dev environment + staged backend.
   - Core journeys for requester and worker across modes.
4. Contract tests
   - Ensure adapter payloads match backend OpenAPI contracts.

## 11.3 Requirement Traceability Matrix

| Requirement | Test Type | Example Test |
| --- | --- | --- |
| FR-010 list tasks | Unit + Integration | list tool validates filters and returns stable pagination |
| FR-011 get task detail | Integration | detail includes pending actions and mode fields |
| FR-020 create task | Integration + E2E | invalid mode inputs rejected; valid payload creates task |
| FR-030 accept submission | Integration + E2E | requester-only enforcement and status transition checks |
| FR-040 payment clarity | Unit | prepare tool returns amount, asset, and next step |
| FR-050 next-step UX | Unit | post-action response contains deterministic next actions |
| FR-060 audit logs | Integration | every tool call persists audit row |
| FR-061 full payload logs | Integration | audit rows include full request/response payloads |
| NFR-001 security | Security tests | unauthorized mutation blocked with correct error code |

## 11.4 Core Test Cases

### 11.4.1 Read Path

1. `list_tasks` with no filters returns normalized list.
2. `list_tasks` with invalid filter types returns `VALIDATION_ERROR`.
3. `get_task` for unknown id returns `NOT_FOUND`.

### 11.4.2 Auth and Role

1. Unlinked user invoking write tool returns `AUTH_REQUIRED`.
2. Worker attempts requester-only action returns `FORBIDDEN_ROLE`.
3. Requester attempts worker-only action returns role error.

### 11.4.3 Payment and Intent

1. Payment-required mutation returns preflight requirements when no signed intent.
2. Expired intent returns `PAYMENT_FAILED` with retry guidance.
3. Settled payment proceeds to backend mutation successfully.

### 11.4.4 Mode Rules

1. Claim mode rejects submission before claim.
2. Pitch mode rejects submission before worker selection.
3. Auction mode rejects winner selection before deadline.

### 11.4.5 Reliability

1. Backend timeout maps to retryable `INTERNAL_ERROR`.
2. p95 latency instrumentation and dashboard data are emitted correctly.

## 11.5 Test Data Strategy

Use seeded fixtures:
- Wallet identities for requester/worker.
- Tasks in each mode and multiple statuses.
- Sample submissions, pitches, bids, and feedback records.

Include deterministic IDs for reproducible assertions.

## 11.6 CI and Commands

Use existing Makefile orchestration and add targets:
- `make test chatgpt-app` (new)
- `make type-check chatgpt-app` (new)
- `make lint-check chatgpt-app` (new)

Gate merges on:
1. Unit + integration pass.
2. Type checks pass.
3. Lint and format checks pass.

## 12. Delivery Plan

### Milestone A: Internal Alpha (3-5 days)

- Scaffold `apps/chatgpt-app`.
- Implement authenticated setup with managed wallet provisioning.
- Implement anonymous read tools + transactional tools for all five modes.
- Implement file upload flows for submissions.
- Add full payload audit logging and p95 metrics.

### Milestone B: Hardening (Week 2)

- Improve stability, diagnostics, and guided UX.
- Expand integration and E2E coverage.
- Validate both Base Sepolia and Base Mainnet environments.

### Milestone C: Multi-Channel Abstraction (Week 3)

- Refactor channel adapters to support non-ChatGPT integrations.
- Finalize interface boundaries and adapter contracts.

## 13. Risks and Mitigations

1. Risk: Payment/signing UX friction in chat.
   - Mitigation: staged intent flow + clear preflight + fallback to CLI/web.
2. Risk: Mode-specific complexity causes model errors.
   - Mitigation: strict tool descriptions, validation, and mode-aware prepare tools.
3. Risk: Backend contract drift.
   - Mitigation: adapter contract tests against OpenAPI/tRPC schemas.
4. Risk: Abuse/spam via automated tool calls with no hard alpha rate limits.
   - Mitigation: anomaly monitoring, alerting, and manual operations response.

## 14. Decisions Locked

1. v1 alpha includes fully executable paid actions.
2. Server wallet flow is used, aligned with current architecture.
3. Both Base Sepolia and Base Mainnet are required.
4. Authenticated setup creates and links a managed wallet automatically.
5. Single linked wallet per user in alpha.
6. Role inferred dynamically per action.
7. Anonymous read access is enabled.
8. All five task modes are included.
9. File uploads are included.
10. Current payment costs are retained.
11. No hard spend caps or hard rate limits in alpha.
12. Full payload audit logs are required.
13. No global kill switch requirement for alpha.
14. Internal alpha target is within a few days.
15. Final product scope approver is the product owner.
16. Service stays separate for clean abstraction boundaries.
17. Architecture must support future non-ChatGPT channel integrations.

## 15. Definition of Done (Release Gate)

1. All scoped FR/NFR items mapped to passing tests.
2. No critical or high-severity security findings.
3. Runbooks for auth/payment/incidents documented.
4. Observability dashboards and alerts live in production.
5. Staging and production connector validation complete.
6. ChatGPT app submission artifacts complete and reviewed.
7. Channel abstraction contracts are stable and reusable for non-ChatGPT integrations.

## 16. Appendix: Existing Code References

- Backend app/middleware wiring: `apps/backend/src/app.ts`
- Root router composition: `apps/backend/src/router.ts`
- Task lifecycle and pending actions: `apps/backend/src/routers/tasks.router.ts`
- Acceptance/rating flows: `apps/backend/src/routers/acceptance.router.ts`
- Claim flow: `apps/backend/src/routers/claims.router.ts`
- Pitch flow: `apps/backend/src/routers/pitches.router.ts`
- Auction flow: `apps/backend/src/routers/bids.router.ts`
- Wallet operations: `apps/backend/src/routers/wallet.router.ts`
- X402 middleware: `apps/backend/src/middleware/x402.ts`
- Shared schemas: `packages/shared/src/schemas/*.ts`
