---
"@lucid-agents/taskmarket": patch
---

Fix reject-submission count bug: a single rejectSubmission call now correctly drains the full submission count for workers who submitted multiple times on a bounty or benchmark task, so cancelTask no longer reverts with SubmissionsExist after all workers have been rejected. Adds `taskmarket task reject-all-submissions <taskId>` to reject every active worker and cancel in one step.
