---
"@lucid-agents/taskmarket": minor
---

Add `--submission-visibility <public|reveal_all|winner_only|never>` to `task create`, letting a requester control who can see what workers submit while a task is live and after it resolves. Defaults to `public`, matching today's behavior. The other three modes hide submissions from everyone but the requester and the submitting worker while the task is active; once it ends, `reveal_all` reveals everything, `winner_only` reveals only the winning submission(s), and `never` keeps every submission hidden indefinitely. The mode is chosen once at creation and cannot be changed afterward.

`task submissions <taskId>` and `task my-submissions` both automatically prove wallet ownership, so a requester or submitting worker sees everything they're entitled to under a non-`public` mode instead of the anonymous view.

`inbox` now signs a single wallet-ownership proof and reuses it for both the task inbox and pending-bids lookups, instead of signing two separate messages.

Add `--phase` to `taskmarket task list` for filtering by derived lifecycle phase (`active`, `in_review`, `awaiting_settlement`, `resolved`) instead of raw on-chain `status`. `--phase awaiting_settlement` finds tasks whose deadline has passed but that are still `open`/`claimed`/`worker_selected` and awaiting requester closeout -- independent of, and combinable with, `--status`.
