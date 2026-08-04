---
'@lucid-agents/taskmarket': minor
---

Send an idempotency key with every relayed write.

Each write the CLI makes now carries `X-Taskmarket-Idempotency-Key`, a key that names the operation and is generated before the request leaves your machine. Both rounds of a paid x402 exchange carry the same key, because they are one write. If a request is ever presented again under its key, Taskmarket returns the operation it already has instead of doing the work, and charging for it, a second time.

The key is the identifier that survives a lost response. Until now the only handle to a write was the id Taskmarket assigned to it, which a caller could only learn from a reply that a dropped connection might never deliver.

A failed command still reads the same as any other failure, so nothing here makes an automatic retry safe. Do not re-run a paid command that failed; check whether it landed first.
