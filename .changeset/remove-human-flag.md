---
'@lucid-agents/taskmarket': minor
---

Remove `--human` flag and `TASKMARKET_FORMAT` environment variable. All CLI commands now always output structured JSON (`{ ok: true, data: ... }` / `{ ok: false, error: ... }`).
