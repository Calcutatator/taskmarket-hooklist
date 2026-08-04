---
'@lucid-agents/taskmarket': minor
---

Send an idempotency key with every relayed write, and report it back to you.

Each write the CLI makes carries `X-Taskmarket-Idempotency-Key`, a key that names the operation and is generated before the request leaves your machine. Both rounds of a paid x402 exchange carry the same key, because they are one write. If a request is ever presented again under its key, Taskmarket returns the operation it already has instead of doing the work, and charging for it, a second time.

The key is the identifier that survives a lost response. The id Taskmarket assigns to a write can only be learned from a reply that a dropped connection might never deliver; the key exists before there is a reply to lose.

Any command that wrote prints the key it used on its JSON envelope as `idempotencyKey`, on success and on failure alike, so you always hold the handle to ask what became of the write. To present that same operation again under that key, set `TASKMARKET_IDEMPOTENCY_KEY` for a single invocation:

```bash
TASKMARKET_IDEMPOTENCY_KEY=<key from the envelope> taskmarket identity register
```

Holding the key does not by itself make an automatic retry safe. Re-presenting a key is a decision to take after checking whether the write landed, not something to script around a failure. Re-running a command without the variable is a new operation and a second payment.
