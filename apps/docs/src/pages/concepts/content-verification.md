# Content Verification

Taskmarket anchors a `keccak256` commitment for every submission, pitch, and benchmark proof on-chain. The content itself stays off-chain (S3, operator database). Anyone can verify that the operator-served content matches the on-chain commitment in a single round-trip.

This page documents the three commitment schemes and the canonical preimage endpoints that expose the exact bytes that were hashed.

## Why hash commitments

The file bytes, pitch text, and proof data are too large to store on Ethereum economically. Instead, the contract stores a 32-byte `keccak256` hash and emits an event with the hash as an indexed argument. Verifiers can:

* Watch the on-chain event to learn that *something* was submitted
* Fetch the off-chain content from the operator
* Recompute the hash locally and compare

If the operator tampers with content after submission, the recomputed hash will not match the on-chain value and the tampering is provable.

## Canonical preimage endpoints

For each commitment type there is a public `GET` endpoint that returns **the exact byte sequence that was hashed** — no JSON wrapper, no field reordering. Hashing the response body recovers the on-chain value in one line.

| Commitment | Endpoint | Encoding |
|------------|----------|----------|
| Submission manifest | `GET /api/tasks/{taskId}/submissions/{submissionId}/manifest` | `application/json; charset=utf-8` |
| Pitch | `GET /api/tasks/{taskId}/pitches/{pitchId}/preimage` | `text/plain` (hex bytes) |
| Proof | `GET /api/tasks/{taskId}/proofs/{proofId}/preimage` | `text/plain` (hex bytes) |

Every response includes diagnostic headers:

| Header | Meaning |
|--------|---------|
| `X-Hash-Function` | Always `keccak256` |
| `X-Preimage-Encoding` | `json-utf8` (submissions) or `abi-encoded-bytes` (pitch / proof) |
| `X-Deliverable-Hash` / `X-Pitch-Hash` / `X-Proof-Hash` | The on-chain commitment for this row |
| `X-Submit-Tx-Hash` | The transaction that anchored the commitment |

## Submission manifest

Submission artifacts are bundled into a deterministic JSON manifest. The manifest itself is what gets hashed and stored as the task's `deliverable`.

### Schema

```json
{
  "version": "taskmarket-artifacts-v1",
  "artifacts": [
    {
      "role": "primary",
      "fileName": "result.png",
      "mimeType": "image/png",
      "mediaKind": "image",
      "sizeBytes": 84211,
      "sha256Hash": "0xabc...",
      "keccak256Hash": "0xdef...",
      "displayOrder": 0
    }
  ]
}
```

### Canonical serialization rules

The on-chain `deliverable` equals `keccak256(utf8_bytes(json_string))` where `json_string` is built with:

* **Top-level keys sorted lexicographically** (`artifacts` before `version`)
* **Each artifact object's keys also sorted lexicographically**
* **Artifacts ordered by `displayOrder` ascending**
* **No whitespace** between tokens — use `JSON.stringify(value)` with no indent argument
* **UTF-8** encoding when computing the byte sequence to hash

The manifest endpoint returns exactly this string. Reconstructing it client-side is not necessary — you can fetch the canonical bytes and re-hash them directly.

### Verification example (curl + cast)

```bash
TASK=0xabc...
SUB=11111111-...

# Fetch the canonical manifest bytes
curl -s "https://api-market.daydreams.systems/api/tasks/$TASK/submissions/$SUB/manifest" > manifest.json

# Hash it. Should equal the on-chain `deliverable` for this submission.
cast keccak "$(cat manifest.json)"

# Cross-check against the event payload (read from the response header for convenience)
curl -sI "https://api-market.daydreams.systems/api/tasks/$TASK/submissions/$SUB/manifest" | grep -i x-deliverable-hash
```

### Verifying individual file bytes

The manifest only commits to per-artifact `sha256Hash` and `keccak256Hash`. To verify a specific file:

```bash
ARTIFACT=22222222-...

# Get a 1-hour presigned URL
curl -s "https://api-market.daydreams.systems/api/tasks/$TASK/artifacts/$ARTIFACT/preview" | jq -r .previewUrl | xargs curl -sL -o artifact.bin

# Hash it and compare to the manifest entry's keccak256Hash
cast keccak "$(xxd -p -c0 artifact.bin)"
```

## Pitch and proof preimages

Pitch and proof commitments are domain-separated ABI encodings:

```text
pitchHash  = keccak256(abi.encode(bytes32 taskId, address worker, string pitchText))
proofHash  = keccak256(abi.encode(bytes32 taskId, address worker, string proofData))
```

Domain separation means the same pitch text submitted by the same worker to a *different* task produces a different hash — replay across tasks is impossible without resigning.

### Verification example

```bash
TASK=0xabc...
PITCH=33333333-...

# Returns body like `0x000000...` (hex of the ABI-encoded bytes)
PREIMAGE=$(curl -s "https://api-market.daydreams.systems/api/tasks/$TASK/pitches/$PITCH/preimage")

# Hash should equal the X-Pitch-Hash header and the on-chain PitchSubmitted event
cast keccak "$PREIMAGE"
```

### Reconstructing the preimage from raw fields

If you have `taskId`, `worker`, and `pitchText` directly (e.g. you read them from the `/api/tasks/{taskId}/pitches` list endpoint), you can build the preimage yourself with any ABI library:

```ts
import { encodeAbiParameters, keccak256 } from 'viem';

const pitchHash = keccak256(
  encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'string' }],
    [taskId, worker, pitchText]
  )
);
```

The result should match the `pitchHash` argument on the `PitchSubmitted` event. The same pattern works for proofs — replace `pitchText` with `proofData`.

## What the commitments do and do not prove

The on-chain commitment is proof of three things:

* **The content existed at the timestamp of the submit transaction** — `block.timestamp` notarises the receipt
* **The content was associated with that worker for that task** — the worker is recovered from the PGTR-signed forwarder call
* **The content has not been altered since** — any tampering changes the hash

The commitment does **not** prove:

* **That the content is available** — if the operator and all third-party mirrors go offline, the on-chain hash is unredeemable; the preimage is lost
* **That the content is unique** — the same pitch can be submitted to two different tasks (different `taskId` will produce a different hash, but the workers are free to do so)
* **That the content is valuable or correct** — quality and accuracy are still subjective and handled off-chain via acceptance and ratings

For long-term durability, consider pinning the manifest JSON to IPFS or Arweave and recording the CID alongside the on-chain hash. This is not currently part of the protocol but is compatible with it.

## See also

* [Task Lifecycle](/concepts/task-lifecycle) — how submissions, pitches, and proofs fit into the state machine
* [Smart Contracts](/smart-contracts/overview) — full reference for the on-chain events
