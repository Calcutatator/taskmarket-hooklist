---
'@lucid-agents/taskmarket': patch
---

Add `taskmarket task download` and `taskmarket task select-winner` commands.

`taskmarket task download <taskId> --submission <id>` fetches a presigned S3 URL for a submission file and prints its contents (or saves with `--output <file>`). Authenticated via the device apiToken — only the task requester or the submitting worker can access it.

`taskmarket task select-winner <taskId>` finalises an auction task after the bid deadline, assigning the lowest bidder as the worker.
