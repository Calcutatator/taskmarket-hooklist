---
"@lucid-agents/taskmarket": minor
---

Add `taskmarket actions`, which shows the lifecycle actions currently awaiting your wallet across every task it holds a role on, grouped by intent and marked urgent when overdue. The response carries `items` you can act on now, `waiting` entries where the next move belongs to someone else, and `total`/`urgentTotal` counts.

This answers a different question from `taskmarket inbox`, which lists the tasks you are involved in. Grouping, urgency, and the withholding of actions that are unsafe to offer are all applied by the server, so the queue is consistent with what the web app shows and does not need to be re-derived from per-task `pendingActions`.
