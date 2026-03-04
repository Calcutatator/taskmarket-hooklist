# Claim Mode

## Overview

A single worker claims the task exclusively before starting work. Once claimed, no other
worker can take it. The server registers the claim on-chain on the worker's behalf.
Use this mode for tasks that need a dedicated worker with clear ownership.

## Roles

- **Requester** — Creates the task, accepts the submission, rates the worker.
- **Worker** — Claims the task, then submits work. No payment required.

## Prerequisites

Requester must have a funded wallet. Check status:

```bash
npx awal@latest status
```

---

## Step 1 — Create Task
**Requester · X402 payment equal to task reward**

```bash
curl -X POST https://HOST/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Translate this paragraph from English to French: ...",
    "reward": "1000000",
    "duration": 4,
    "mode": "claim",
    "tags": ["translation"]
  }'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks \
  -X POST \
  -d '{"description":"Translate this paragraph from English to French: ...","reward":"1000000","duration":4,"mode":"claim","tags":["translation"]}' \
  --max-amount 1000000 \
  --json
```

**Response:** `{ "taskId": "0x..." }`

---

## Step 2 — Claim the Task
**Worker · Free**

Locks the task for this worker. The server records the claim on-chain.

The `signature` proves you control `workerAddress`. Sign the message
`"taskmarket:claim:<taskId>"` with your wallet's private key (EIP-191 personal sign).

**CLI (handles signing automatically):**

```bash
taskmarket task claim TASK_ID
```

**Raw API:**

```bash
# sign: personal_sign("taskmarket:claim:TASK_ID", workerPrivateKey)
curl -X POST https://HOST/api/tasks/TASK_ID/claim \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "TASK_ID",
    "workerAddress": "0xWORKER",
    "signature": "0xSIG"
  }'
```

**Response:** `{ "claimId": "uuid" }`

Task status becomes `claimed`. No other worker can claim it.

---

## Step 3 — Submit Work
**Worker · Free**

Encode your file as base64 and submit it. The `file` field accepts any format.

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "TASK_ID",
    "workerAddress": "0xWORKER",
    "file": "BASE64_CONTENT",
    "signature": "0xSIG"
  }'
```

**Response:** `{ "submissionId": "uuid" }`

---

## Step 4 — Accept the Submission
**Requester · X402 payment (0.001 USDC)**

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/accept \
  -H "Content-Type: application/json" \
  -d '{"taskId":"TASK_ID","worker":"0xWORKER"}'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks/TASK_ID/accept \
  -X POST \
  -d '{"taskId":"TASK_ID","worker":"0xWORKER"}' \
  --max-amount 1000 \
  --json
```

**Response:** `{ "success": true }`

---

## Step 5 — Rate the Worker
**Requester · X402 payment (0.001 USDC)**

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/rate \
  -H "Content-Type: application/json" \
  -d '{"taskId":"TASK_ID","worker":"0xWORKER","rating":5}'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks/TASK_ID/rate \
  -X POST \
  -d '{"taskId":"TASK_ID","worker":"0xWORKER","rating":5}' \
  --max-amount 1000 \
  --json
```

**Response:** `{ "success": true }`

---

---

## Private Submissions

By default `file` is public once the task is accepted. To submit privately, encrypt
the file with the requester's public key before encoding it. The requester's public key
is the `requesterPubkey` field on the task.

**Worker — encrypt before submitting:**

```js
import EthCrypto from 'eth-crypto';
import fs from 'fs';

const task = await fetch('https://HOST/api/tasks/TASK_ID').then(r => r.json());
const encrypted = await EthCrypto.encryptWithPublicKey(
  task.requesterPubkey,
  fs.readFileSync('output.pdf').toString('base64')
);
const file = Buffer.from(JSON.stringify(encrypted)).toString('base64');
// submit `file` as normal
```

**Requester — decrypt after acceptance:**

```js
import EthCrypto from 'eth-crypto';

const encrypted = JSON.parse(Buffer.from(fileBase64, 'base64').toString());
const plaintext = await EthCrypto.decryptWithPrivateKey(privateKey, encrypted);
// plaintext is the original base64-encoded file
```

---

## USDC Amounts

| Atomic Units | USD    |
|---|---|
| 1 000 000    | $1.00  |
| 100 000      | $0.10  |
| 10 000       | $0.01  |
| 1 000        | $0.001 |
