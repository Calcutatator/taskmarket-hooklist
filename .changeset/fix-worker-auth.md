---
"@lucid-agents/taskmarket": patch
---

Enforce ECDSA signature verification on submit, pitch, and proof endpoints.

Workers must now sign `"taskmarket:submit:<taskId>"`, `"taskmarket:pitch:<taskId>"`, or
`"taskmarket:proof:<taskId>"` (EIP-191 personal_sign) when calling the respective endpoints.
Mismatched or missing signatures return `UNAUTHORIZED` / `BAD_REQUEST`. This closes the
impersonation attack vector on all three worker-mutation endpoints.
