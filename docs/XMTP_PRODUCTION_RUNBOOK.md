# XMTP Production Wiring Runbook

## Scope
This runbook covers CLI runtime incidents for live XMTP transport in production mode (`TASKMARKET_XMTP_ENV=production`). Backend remains control-plane only.

## Preconditions
1. CLI dependency present: `@xmtp/node-sdk`.
2. Keystore exists with `deviceId`, `apiToken`, and encrypted key.
3. Backend control-plane endpoints enabled (`XMTP_ENABLED=true`).
4. Runtime DB path is writable (`TASKMARKET_XMTP_DB_DIR` or default `~/.taskmarket/xmtp`).

## Operator Validation Checklist
1. Validate control plane: `make smoke xmtp`.
2. Validate live transport offline catch-up: `make smoke xmtp-live`.
3. Validate query timeout behavior: `taskmarket xmtp query --to <inboxId> --type <type> --json '<payload>' --timeout-ms <n>`.
4. Validate status heartbeat after runtime starts: `taskmarket xmtp status`.

## Common Failure Modes

### SDK init failures
Symptoms:
- CLI error includes `requires @xmtp/node-sdk`.
- CLI error includes `compatible client factory`.

Checks:
1. Confirm dependency install completed in workspace.
2. Confirm production env is intentionally enabled.
3. Confirm keystore decrypt path can fetch DEK from backend.

Remediation:
1. Re-run dependency install (`make init`).
2. Verify device credentials (`deviceId`, `apiToken`) are active.
3. If SDK API changed, patch the adapter boundary in `apps/cli/src/lib/xmtp-client.ts`.

### Repeated send retries
Symptoms:
- Frequent send failures after bounded retries.
- Errors indicate transient network/rate-limit conditions.

Checks:
1. Confirm network reachability and XMTP service health.
2. Inspect error category (`retryable` vs `non-retryable`) in CLI logs/output.
3. Confirm sender/receiver inbox IDs are correct.

Remediation:
1. Reduce sender concurrency for affected workers.
2. Increase timeout/retry tuning only after transport health is confirmed.
3. Escalate non-retryable failures for config/schema correction.

### Stream reconnect loops / catch-up not observed
Symptoms:
- Listener repeatedly reconnects.
- Receiver misses messages sent while listener was offline.

Checks:
1. Confirm runtime DB path is stable and writable.
2. Confirm listener process is using production mode, not dev fallback.
3. Reproduce with `make smoke xmtp-live` and compare sender request ID vs received request ID.

Remediation:
1. Fix filesystem permission/path issues.
2. Restart listener with corrected env and persistent DB path.
3. If reconnect storms continue, capture error traces and escalate to SDK adapter review.

### Query timeout spikes
Symptoms:
- Query errors return `XMTP query timed out after <n>ms`.

Checks:
1. Confirm peer listener is active and handling message type.
2. Confirm peer policy allows sender inbox.
3. Compare timeout value to expected handler latency.

Remediation:
1. Resolve policy denials first.
2. Increase timeout only after confirming normal transport and handler execution.
3. Track timeout count and reconnect incidents during rollout.

## Rollout Guardrails
1. Keep production wiring behind `TASKMARKET_XMTP_ENV=production` during phased rollout.
2. Run both control-plane and live smoke checks before expanding cohort.
3. Stop cohort expansion on repeated non-retryable transport errors or sustained query timeout growth.
