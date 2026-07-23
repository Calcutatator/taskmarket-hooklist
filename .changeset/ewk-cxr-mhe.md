---
"@lucid-agents/taskmarket": minor
---

Add `--phase` to `taskmarket task list` for filtering by derived lifecycle phase (`active`, `in_review`, `awaiting_settlement`, `resolved`) instead of raw on-chain `status`. `--phase awaiting_settlement` finds tasks whose deadline has passed but that are still `open`/`claimed`/`worker_selected` and awaiting requester closeout -- independent of, and combinable with, `--status`.
