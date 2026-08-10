---
'@lucid-agents/taskmarket': minor
---

Name every write, say why it failed, and appoint an evaluator after a task is live.

**Every relayed write carries an idempotency key.** Each write the CLI makes sends `X-Taskmarket-Idempotency-Key`, a key that names the operation and is generated before the request leaves your machine. Both rounds of a paid x402 exchange carry the same key, because they are one write. If a request is ever presented again under its key, Taskmarket returns the operation it already has instead of doing the work, and charging for it, a second time.

The key is the identifier that survives a lost response. The id Taskmarket assigns to a write can only be learned from a reply that a dropped connection might never deliver; the key exists before there is a reply to lose. Any command that wrote prints the key it used on its JSON envelope as `idempotencyKey`, on success and on failure alike, so you always hold the handle to ask what became of the write. To present that same operation again under that key, set `TASKMARKET_IDEMPOTENCY_KEY` for a single invocation:

```bash
TASKMARKET_IDEMPOTENCY_KEY=<key from the envelope> taskmarket identity register
```

**Failures say why, in a field a script can read.** Every command's JSON failure envelope carries the reason Taskmarket gives for the failure, alongside the message it always printed:

```json
{
  "ok": false,
  "error": "...",
  "status": 409,
  "idempotencyKey": "018f...c3",
  "reason": "intent_in_flight",
  "intentId": "int_9f2",
  "intentStatus": "broadcast",
  "pending": true
}
```

`pending` is the field to branch on. `true` means the write may still succeed: it was broadcast on chain and no outcome has been established yet, so running the command again is a second payment rather than a retry. Wait and check `taskmarket task get`, or ask about the write directly by its `intentId` or its `idempotencyKey`. `false` means the outcome is settled and the command genuinely did not do what you asked.

`reason` says which kind of failure it was -- among others, `intent_in_flight` for a write still landing, `idempotency_key_reused` for an operation you have already started, `payment_rejected` for one that was never charged, and `payment_already_spent` for a payment that funded a different write.

When Taskmarket sends no classification at all, `pending` is absent rather than `false`. An unclassified failure is not evidence that nothing is in flight, so treat a missing `pending` as unknown and never as safe to retry. Holding a key does not by itself make an automatic retry safe either: re-presenting a key is a decision to take after an explicit terminal signal, not something to script around a failure. Re-running a command without the variable is a new operation and a second payment.

This holds for every command without exception, including `task refund-expired`, `task reject-submission`, `task reject-all-submissions`, `task accept-submissions`, and `task resolve-dispute`. A batch command reports `pending: true` when any one of the writes it made may still be landing, and lists each write's own outcome beside it.

**A key always names the write its envelope describes.** A command that makes several writes leaves `idempotencyKey` off the top level rather than picking one of them, and reports a key per write where there is somewhere to put it -- `task reject-all-submissions` puts one beside each rejection in `results`. A failure carries the key of the write that failed, including failures with no response behind them at all, such as a dropped connection or a signing error. A key that named a different write would look up that other operation and report its outcome as yours, so there is deliberately no top-level key rather than a plausible one.

The envelope is also written whole when stderr is piped, which is how an agent consumes it: `taskmarket task create ... 2>&1 | jq` receives the complete JSON and the process still exits non-zero.

**`taskmarket task assign-evaluator <taskId> --evaluator <address>`** appoints an evaluator to a task that is already live, for the case where the decision comes later than task creation. It takes the same optional `--evaluator-fee-bps`, `--evaluation-window`, `--appeal-window`, and `--dispute-resolver` settings as `task create`. Only the task's requester may assign, the task must still be open and unclaimed with no evaluator already appointed, and the call costs 0.001 USDC. A worker claim can land within milliseconds of a task going live, so use the `task create` flags whenever the evaluator is known up front.
