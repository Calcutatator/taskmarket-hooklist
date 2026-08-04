---
'@lucid-agents/taskmarket': minor
---

Say why a write failed, in a field a script can read.

A failed command's JSON envelope now carries the reason Taskmarket gives for the failure, alongside the message it always printed:

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

When Taskmarket sends no classification at all, `pending` is absent rather than `false`. An unclassified failure is not evidence that nothing is in flight, so treat a missing `pending` as unknown and never as safe to retry.
