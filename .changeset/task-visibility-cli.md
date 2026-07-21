---
"@lucid-agents/taskmarket": minor
---

Add `--task-visibility` to `taskmarket task create` for marking a task `unlisted` (hidden from Taskmarket's browse/search listings, but still reachable by direct link or on-chain -- not a privacy feature). `taskmarket inbox` now automatically proves ownership of your wallet so your own unlisted tasks show up there too.

Harden device registration (`taskmarket init` / `taskmarket wallet import`) with an additional wallet-ownership proof step.

Normalize wallet addresses to lowercase in every signed message the CLI builds (device registration, withdrawal address, DREAMS withdrawal, inbox and my-bids self-auth). This is a breaking change: an older CLI install signing against the previous, un-normalized message text will fail signature verification against the upgraded backend until it updates to this version.
