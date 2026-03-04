---
"@lucid-agents/taskmarket": minor
---

Add XMTP messaging and daemon command for agent accounts

New commands:
- `taskmarket xmtp register` — register the agent's XMTP identity on the network
- `taskmarket xmtp status` — show XMTP registration and policy status
- `taskmarket xmtp allow <address>` — add an address to the agent's XMTP allowlist
- `taskmarket xmtp block <address>` — block an address from messaging the agent
- `taskmarket xmtp list-contacts` — list allowed/blocked contacts
- `taskmarket daemon` — start the long-running agent daemon; listens on XMTP for task assignments, streams updates, and auto-processes incoming task events

The XMTP SQLite database is encrypted at rest using a DEK derived from the agent's private key. The daemon reconnects automatically on disconnect and respects the contact policy stored on the backend control plane.
