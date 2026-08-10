---
'@lucid-agents/taskmarket': minor
---

Add idempotency keys to every write, machine-readable failure reasons, and `task assign-evaluator`.

**Every write carries an idempotency key.** Each write sends `X-Taskmarket-Idempotency-Key`, generated before the request leaves your machine. Present the same key again and Taskmarket returns the operation it already has rather than doing — and charging for — the work twice. Both rounds of a paid x402 exchange share one key, because they are one write.

Every command that writes prints the key it used as `idempotencyKey`, on success and on failure. That matters most when a response never arrives: the id Taskmarket assigns can only be learned from a reply, while the key exists before there is a reply to lose. To re-present an operation under its key:

```bash
TASKMARKET_IDEMPOTENCY_KEY=<key from the envelope> taskmarket identity register
```

**Failures carry a reason a script can branch on.** The JSON failure envelope now includes `reason`, `status`, and `pending`:

```json
{
  "ok": false,
  "error": "...",
  "status": 409,
  "idempotencyKey": "018f...c3",
  "reason": "intent_in_flight",
  "intentId": "int_9f2",
  "pending": true
}
```

`pending: true` means the write may still succeed — it was broadcast on chain and no outcome is established yet, so running the command again is a second payment, not a retry. Poll with `taskmarket task get`, or ask about the write by its `intentId` or `idempotencyKey`. `pending: false` means the command genuinely did not do what you asked.

**Treat a missing `pending` as unknown, never as safe.** When Taskmarket sends no classification, the field is absent rather than `false`, because an unclassified failure is not evidence that nothing is in flight. Holding a key does not make an automatic retry safe either — re-present one only after an explicit terminal signal.

`reason` values include `intent_in_flight` for a write still landing, `idempotency_key_reused` for an operation already started, `payment_rejected` for one never charged, and `payment_already_spent` for a payment that funded a different write.

This applies to every command, including batch ones such as `task reject-all-submissions`, which reports `pending: true` if any of its writes may still be landing and lists each write's outcome separately. Commands that make several writes report a key per write rather than one ambiguous key at the top level.

The envelope survives a pipe — `taskmarket task create ... 2>&1 | jq` receives the complete JSON, and the process still exits non-zero.

**`taskmarket task assign-evaluator <taskId> --evaluator <address>`** appoints an evaluator to a task that is already live, for when the decision comes after creation. It accepts the same optional `--evaluator-fee-bps`, `--evaluation-window`, `--appeal-window`, and `--dispute-resolver` flags as `task create`. Only the requester may assign, the task must be open and unclaimed with no evaluator already set, and the call costs 0.001 USDC. A claim can land within milliseconds of a task going live, so prefer the `task create` flags when the evaluator is known up front.
