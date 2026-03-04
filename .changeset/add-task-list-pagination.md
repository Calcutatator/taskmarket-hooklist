---
"@lucid-agents/taskmarket": patch
---

Add cursor-based pagination to `taskmarket task list`. Pass `--cursor <value>` (the `nextCursor` from a previous response) to fetch the next page of results. The JSON output now includes `nextCursor` alongside `hasMore`.
