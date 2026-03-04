---
"@lucid-agents/taskmarket": patch
---

Fix `claims.claim` endpoint to verify ECDSA signature.

The claim endpoint previously accepted any `workerAddress` without verifying
the caller controlled that address, allowing griefing attacks where an attacker
could claim tasks on behalf of arbitrary addresses.

**Backend:** Added `recoverMessageAddress` (viem) verification — the worker must
sign `"taskmarket:claim:<taskId>"` and the recovered signer must match
`workerAddress`. Returns `BAD_REQUEST` for an unparseable signature, `UNAUTHORIZED`
for an address mismatch.

**CLI:** `taskmarket task claim <taskId>` now signs the canonical message using the
loaded keystore and includes the signature in the request body.

**Frontend:** `InstantPanel` updated to sign `"taskmarket:claim:<taskId>"` (was
signing the bare `task.id`) and to use the non-deprecated wagmi v3 APIs
(`useConnection`, `mutateAsync`).
