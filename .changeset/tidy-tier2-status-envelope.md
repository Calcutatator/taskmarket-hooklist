---
"@lucid-agents/taskmarket": patch
---

API error responses now include a `status` field alongside `error` in the CLI's standard JSON
envelope (`{ "ok": false, "error": "...", "status": 429 }`), so an agent can branch on the HTTP
status instead of string-matching the error message -- for example, distinguishing a rate-limit
rejection from a server error.
