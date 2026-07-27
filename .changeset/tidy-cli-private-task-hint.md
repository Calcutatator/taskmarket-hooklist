---
"@lucid-agents/taskmarket": patch
---

`task get` on a task that doesn't exist or is a private task you can't access now hints that you may need `task unlock <taskId> --password <password>`, instead of just reporting the task as not found.
