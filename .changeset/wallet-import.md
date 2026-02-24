---
"@lucid-agents/taskmarket": minor
---

Add `taskmarket wallet import` command to import an existing private key instead of
generating a fresh one at init time. Supports three input methods: `--key` flag,
`TASKMARKET_IMPORT_KEY` env var, and interactive hidden prompt (recommended).
