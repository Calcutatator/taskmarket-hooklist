# Worked Example: Expiry Abort

This trace shows the correct response when a task appears open but is already expired.

## Setup

User: "Submit to task `0xdead...` on Base Mainnet."

Network intent: Base Mainnet. Confirm production defaults before touching wallet state.

```bash
$ printf 'TASKMARKET_API_URL=%s\n' "${TASKMARKET_API_URL:-https://api.taskmarket.dev}"
TASKMARKET_API_URL=https://api.taskmarket.dev
$ taskmarket deposit
{
  "ok": true,
  "data": {
    "chainId": 8453,
    "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }
}
```

## Fetch

```bash
$ TASK_ID=0xdead...
$ taskmarket task get "$TASK_ID" > ".context/taskmarket/${TASK_ID}.json"
$ jq '.data | {status, expiryTime, pendingActions}' ".context/taskmarket/${TASK_ID}.json"
{
  "status": "open",
  "expiryTime": "2026-05-16T01:00:00Z",
  "pendingActions": [
    { "role": "worker", "action": "submit", "command": "taskmarket task submit 0xdead... --file <path>" }
  ]
}
```

## Freshness Check

```bash
$ date -u +"%Y-%m-%dT%H:%M:%SZ"
2026-05-16T02:10:00Z

$ node -e 'const t=Date.parse(process.argv[1]); process.exit(Number.isFinite(t) && Date.now() < t ? 0 : 1)' "2026-05-16T01:00:00Z"
# exits nonzero
```

## Correct Response

Stop. Do not produce the deliverable and do not submit. Report:

- Task `0xdead...` is expired.
- API still shows `status: open`, but current UTC is after `expiryTime`.
- No side effect was taken.

If the User explicitly wants a local draft or smoke test despite expiry, confirm that it will not be submitted or paid.
