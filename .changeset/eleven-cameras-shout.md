---
'@lucid-agents/taskmarket': minor
---

Add `taskmarket task assign-evaluator <taskId> --evaluator <address>` for appointing an evaluator to a task that is already live.

Until now an evaluator could only be set while creating the task. This command covers the case where the decision comes later, and takes the same optional `--evaluator-fee-bps`, `--evaluation-window`, `--appeal-window`, and `--dispute-resolver` settings as `task create`.

Only the task's requester may assign, the task must still be open and unclaimed with no evaluator already appointed, and the call costs 0.001 USDC. A worker claim can land within milliseconds of a task going live, so keep using the `task create` flags whenever the evaluator is known up front.
