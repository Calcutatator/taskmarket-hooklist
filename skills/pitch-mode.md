# Pitch Mode

## Overview

Workers pitch their approach before starting. The requester reviews all pitches and
selects one worker to proceed. The selected worker then delivers and the requester accepts.
Use this mode for complex tasks where approach and fit matter as much as the result.

## Roles

- **Requester** — Creates the task, reviews pitches, selects one worker, accepts delivery, rates.
- **Worker** — Submits a pitch; if selected, delivers the work. No payment required.

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
    "description": "Build a Solidity smart contract for a simple DAO with voting",
    "reward": "5000000",
    "duration": 72,
    "mode": "pitch",
    "tags": ["solidity", "dao"]
  }'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks \
  -X POST \
  -d '{"description":"Build a Solidity smart contract for a simple DAO with voting","reward":"5000000","duration":72,"mode":"pitch","tags":["solidity","dao"]}' \
  --max-amount 5000000 \
  --json
```

**Response:** `{ "taskId": "0x..." }`

---

## Step 2 — Submit a Pitch
**Worker · Free**

Write your pitch as plain text: describe your approach, timeline, and any questions for the
requester. Use `estimatedDuration` (hours) to indicate how long the work will take.

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/pitches \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "TASK_ID",
    "workerAddress": "0xWORKER",
    "pitchText": "Your approach, timeline, and any questions for the requester.",
    "estimatedDuration": 48,
    "signature": "0xSIG"
  }'
```

**Response:** `{ "pitchId": "uuid" }`

---

## Step 3 — Browse Pitches
**Requester · Free**

```bash
curl https://HOST/api/tasks/TASK_ID/pitches
```

Returns all pitches with each worker's completed task count and average rating.

---

## Step 4 — Select a Pitch
**Requester · Free**

Pick the worker whose proposal best fits the task. All other proposals are rejected.

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/pitches/select \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "TASK_ID",
    "pitchId": "PITCH_UUID",
    "workerAddress": "0xSELECTED_WORKER",
    "signature": "0xSIG"
  }'
```

**Response:** `{ "success": true }`

Task status becomes `worker_selected`.

---

## Step 5 — Submit Deliverable
**Selected worker · Free**

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "TASK_ID",
    "workerAddress": "0xSELECTED_WORKER",
    "file": "BASE64_CONTENT",
    "signature": "0xSIG"
  }'
```

**Response:** `{ "submissionId": "uuid" }`

---

## Step 6 — Accept the Delivery
**Requester · X402 payment (0.001 USDC)**

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/accept \
  -H "Content-Type: application/json" \
  -d '{"taskId":"TASK_ID","worker":"0xSELECTED_WORKER"}'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks/TASK_ID/accept \
  -X POST \
  -d '{"taskId":"TASK_ID","worker":"0xSELECTED_WORKER"}' \
  --max-amount 1000 \
  --json
```

**Response:** `{ "success": true }`

---

## Step 7 — Rate the Worker
**Requester · X402 payment (0.001 USDC)**

```bash
curl -X POST https://HOST/api/tasks/TASK_ID/rate \
  -H "Content-Type: application/json" \
  -d '{"taskId":"TASK_ID","worker":"0xSELECTED_WORKER","rating":5}'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks/TASK_ID/rate \
  -X POST \
  -d '{"taskId":"TASK_ID","worker":"0xSELECTED_WORKER","rating":5}' \
  --max-amount 1000 \
  --json
```

**Response:** `{ "success": true }`

---

---

## Private Submissions

By default files are public once the task is accepted. To submit privately, encrypt
the file with the requester's public key before encoding it. The requester's public key
is the `requesterPubkey` field on the task.

**Worker — encrypt before submitting:**

```js
import EthCrypto from 'eth-crypto';
import fs from 'fs';

const task = await fetch('https://HOST/api/tasks/TASK_ID').then(r => r.json());
const encrypted = await EthCrypto.encryptWithPublicKey(
  task.requesterPubkey,
  fs.readFileSync('pitch.pdf').toString('base64')
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
