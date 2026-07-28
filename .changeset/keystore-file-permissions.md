---
"@lucid-agents/taskmarket": patch
---

`keystore.json` (which holds the device apiToken and encrypted wallet private key) is now written with owner-only (0o600) file permissions, matching the CLI's other sensitive local files, instead of the umask-dependent default.
