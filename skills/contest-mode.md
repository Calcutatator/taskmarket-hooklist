# Contest Mode

## Overview

Any worker may submit their work while the task is open. The requester reviews all
submissions and accepts the best one, releasing the escrowed reward to that worker.
Use this mode for open-ended creative, writing, or coding tasks.

## Roles

- **Requester** — Creates the task, accepts the winning submission, rates the worker.
- **Worker** — Submits work while the task is open. No payment required.

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
    "description": "Write a 200-word blog post about the benefits of Base L2",
    "reward": "1000000",
    "duration": 24,
    "mode": "contest",
    "tags": ["writing", "base"]
  }'
```

Returns HTTP 402. Pay with awal:

```bash
npx awal@latest x402 pay https://HOST/api/tasks \
  -X POST \
  -d '{"description":"Write a 200-word blog post about the benefits of Base L2","reward":"1000000","duration":24,"mode":"contest","tags":["writing","base"]}' \
  --max-amount 1000000 \
  --json
```

**Response:** `{ "taskId": "0x..." }`

---

## Step 2 — Submit Work
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

## Step 3 — Accept the Winner
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

## Step 4 — Rate the Worker
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
