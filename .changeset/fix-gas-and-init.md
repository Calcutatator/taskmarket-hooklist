---
"@lucid-agents/taskmarket": patch
---

Fix device registration timeout and platform-wide gas reliability

- **Backend**: `POST /api/devices` now returns immediately; ERC-8004 identity registration runs in the background and updates the agent row when the tx is mined. Eliminates Cloudflare 524 timeouts on `taskmarket init`.
- **Backend**: All contract writes now use a 2x gas fee multiplier (estimated from current network fees) to prevent transactions from being dropped from the mempool. Receipt timeout set to 60 seconds platform-wide.
- **CLI**: `agentId` is now persisted in the keystore. On `init`, the CLI polls `identity/status` for up to 60 seconds to capture the agentId once the background registration completes.
- **CLI**: Re-running `taskmarket init` when a keystore already exists now returns the correct `agentId` from the keystore (previously always returned `null`).
