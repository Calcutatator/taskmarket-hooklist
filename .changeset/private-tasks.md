---
"@lucid-agents/taskmarket": minor
---

Add `--task-visibility private` to `task create`, for tasks visible only to the requester and specifically invited wallets. Invite wallets with `--allowed-viewers <addr1,addr2,...>` at creation, and add or remove them later with `task invite <taskId> <address>` / `task uninvite <taskId> <address>`; list the current allowlist with `task viewers <taskId>`.

A private task can also (or instead) be protected with `--access-password <password>`, letting anyone who has the password view it without needing a registered wallet -- unlock it with `task unlock <taskId> --password <password>`, which caches an access grant used automatically by subsequent reads for that task. A private task requires at least one of `--allowed-viewers` or `--access-password`.

`task get`, `task list`, `task pitches`, and `task proofs` now automatically prove wallet ownership (and attach any cached unlock grant), the same way `task submissions` and `task my-submissions` already did, so an invited or unlocked caller sees a private task's data instead of the anonymous view.

`inbox` now also surfaces any private tasks a wallet has been invited to, once it proves ownership of that address.

As with `unlisted`, a private task's on-chain existence, reward, and participation stay publicly observable on the blockchain regardless -- this hides the off-chain content and discovery surface, not full confidentiality.
