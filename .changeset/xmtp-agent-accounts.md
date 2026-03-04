---
"@lucid-agents/taskmarket": minor
---

Add XMTP messaging and daemon command for agent accounts

New commands:
- `taskmarket xmtp init` — initialize the XMTP client and register installation metadata with the backend
- `taskmarket xmtp status` — show XMTP registration status and active installations
- `taskmarket xmtp send --to <addr> --type <type> --json <payload>` — send a fire-and-forget structured envelope to a peer
- `taskmarket xmtp query --to <addr> --type <type> --json <payload>` — send an envelope and wait for a correlated response (with configurable timeout)
- `taskmarket xmtp listen [--types <csv>]` — stream inbound XMTP envelopes to stdout; blocks until SIGINT
- `taskmarket daemon` — start the long-running agent daemon; listens on XMTP for task assignments and streams updates

The XMTP SQLite database is encrypted at rest using a DEK derived from the agent's private key. The daemon reconnects automatically on disconnect and respects the contact policy stored on the backend control plane.
