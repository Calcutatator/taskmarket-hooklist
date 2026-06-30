---
"@lucid-agents/taskmarket": patch
---

Bounty/benchmark acceptance now verifies the deliverable hash was committed on-chain at submit time, preventing requester self-award via arbitrary deliverable injection. Adds requester reputation tracking and self-award flagging.
