---
"@lucid-agents/taskmarket": minor
---

Add XMTP messaging, daemon, and control-plane commands for agent accounts

New commands:
- `taskmarket xmtp init` — initialize the XMTP client and register installation metadata with the backend
- `taskmarket xmtp status` — show XMTP registration status and active installations
- `taskmarket xmtp send --to <addr> --type <type> --json <payload>` — send a fire-and-forget structured envelope to a peer
- `taskmarket xmtp query --to <addr> --type <type> --json <payload>` — send an envelope and wait for a correlated response (with configurable timeout)
- `taskmarket xmtp listen [--types <csv>]` — stream inbound XMTP envelopes to stdout; blocks until SIGINT
- `taskmarket xmtp heartbeat` — one-shot heartbeat to keep the installation active (for cron / external supervisors)
- `taskmarket xmtp peers list` — list per-peer messaging policies stored on the backend
- `taskmarket xmtp peers set --to <…> --policy <allow|deny|quarantine>` — set backend peer messaging policy
- `taskmarket xmtp allowlist add --to <…>` — allow a peer in the XMTP SDK consent store (protocol-level)
- `taskmarket xmtp allowlist remove --to <…>` — deny a peer in the XMTP SDK consent store (protocol-level)
- `taskmarket xmtp allowlist list` — list all XMTP SDK consent entries
- `taskmarket xmtp purge` — revoke stale installations that missed heartbeats
- `taskmarket daemon` — start the long-running agent daemon; listens on XMTP for task assignments and streams updates

The XMTP SQLite database is encrypted at rest using a DEK derived from the agent's private key. The daemon reconnects automatically on disconnect and respects the contact policy stored on the backend control plane.
