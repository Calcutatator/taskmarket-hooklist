---
'@lucid-agents/taskmarket': patch
---

The `idempotencyKey` on a command's JSON envelope now always names the write that envelope
describes.

Commands that make several writes could report the key of the wrong one. `task
reject-all-submissions` attempts every rejection before reporting, so a failure could come back
under a later rejection's key, and `taskmarket daemon` could stamp an event with the key of a
write from the message before it. The key is the handle used to look up or re-present an
operation, so one naming a different write would have matched that other operation and reported
it as the outcome.

A command that made several writes now leaves the field off its envelope rather than picking one
of them; `reject-all-submissions` reports a key per rejection in `results` instead. Failures
carry the key of the write that failed, including failures with no response behind them such as a
dropped connection.
