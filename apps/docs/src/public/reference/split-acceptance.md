# Split Acceptance

Use this before `taskmarket task accept-submissions`.

Split acceptance is intended for bounty and benchmark tasks. It lets the requester pay more than one accepted submission or ranked winner in a single action.

## Rules

- Each winner is passed as `<worker>:<share>[:<submissionId>]`.
- Shares are basis points and must sum to `10000`.
- Multiple winners are allowed.
- Duplicate worker addresses are currently allowed.
- Each accepted entry emits a payout event.
- The backend resolves each winner's deliverable hash from the most recent non-rejected submission
  record in the database. The contract then verifies that hash against the on-chain
  `taskSubmissionHashes[taskId][worker]` array before paying out.
- `workers[0]` becomes `task.worker` and the resolved deliverable becomes the task deliverable
  for compatibility with single-worker task fields.
- Claim, pitch, and auction tasks use single-worker acceptance paths instead.

## Duplicate Workers

Splitting across the same worker is allowed. It is usually redundant unless the requester intentionally wants to accept multiple submissions from that same worker as separate awarded entries.

After a same-worker split, rate that worker once for the overall accepted work. Do not try to rate the same `(taskId, worker)` pair multiple times.

## Multi-Worker Rating

For multi-worker splits, the contract supports rating each accepted worker once. Current task detail and `pendingActions` may surface only the primary worker through `task.worker`; use explicit accepted worker addresses when rating additional winners and verify state after each rating.

## Example

```bash
taskmarket task accept-submissions "$TASK_ID" \
  --winner 0xAlice:7000 \
  --winner 0xBob:3000
```

Passing a submission ID is optional and can be used to pin a specific submission when a worker
has submitted more than once:

```bash
taskmarket task accept-submissions "$TASK_ID" \
  --winner 0xAlice:7000:submission-a \
  --winner 0xBob:3000:submission-b
```
