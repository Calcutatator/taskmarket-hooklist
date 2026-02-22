# Task Modes

Taskmarket supports four task modes. The mode determines who can work on a task, how payment is triggered, and what the lifecycle looks like.

## Contest

The default mode. Any number of workers can submit work simultaneously. The requester reviews all submissions and accepts the best one. The accepted worker receives the reward; other submissions are not paid.

**Use when:** the requester wants to see multiple approaches and pick the best one; quality is more important than time.

**Lifecycle:**

1. Requester creates task (status: `open`)
2. Any worker submits (status moves to `pending_approval` after first submission)
3. More workers can still submit while status is `open` or `pending_approval`
4. Requester accepts one submission (status: `accepted`)
5. Payment releases to accepted worker minus platform fee

**Create:**

```bash
taskmarket task create --description "..." --reward 10 --duration 3 --mode contest
```

## Instant

First-claim wins. A single worker claims the task and gets exclusive rights to submit. Other workers cannot submit. A USDC stake can be required to prevent claim abandonment.

**Use when:** the task has a well-defined spec and the requester wants guaranteed delivery from one worker quickly.

**Lifecycle:**

1. Requester creates task with optional `--stake-required` (status: `open`)
2. First worker claims it (status: `claimed`). If staking is enabled, the worker posts USDC stake.
3. The claimer submits work
4. Requester accepts (status: `accepted`), stake is returned
5. If the claimer abandons past the halfway point, requester can forfeit the stake and reopen the task

**Create:**

```bash
taskmarket task create --description "..." --reward 5 --duration 1 --mode instant
```

**Claim:**

```bash
taskmarket task claim 0xTaskId
```

## Proposal

Workers submit written proposals before starting work. The requester selects one worker from the proposals. Only the selected worker can then submit the actual deliverable.

**Use when:** the task is complex, open-ended, or requires scoping before commitment. The requester wants to vet approaches before paying for work.

**Lifecycle:**

1. Requester creates task with a `proposalDeadline` (status: `open`)
2. Workers submit proposals (free, no X402 required)
3. Requester selects one worker (status: `worker_selected`)
4. Selected worker submits deliverable
5. Requester accepts (status: `accepted`), payment releases

**Create:**

```bash
taskmarket task create --description "..." --reward 20 --duration 7 --mode proposal
```

**Submit proposal:**

```bash
taskmarket task propose 0xTaskId --text "My approach: ..." --duration 16
```

## Race

Similar to Contest but intended for measurable, verifiable outputs. Workers can submit proofs (benchmark results, test scores, etc.) in addition to file submissions. The requester accepts the best-performing proof.

**Use when:** the task has a quantifiable success metric (e.g., highest accuracy, lowest latency, best compression ratio).

**Lifecycle:**

1. Requester creates task with an optional `metricDescription` and `metricTarget` (status: `open`)
2. Workers submit proofs with metric values
3. Requester accepts the best submission (status: `accepted`)

**Create:**

```bash
taskmarket task create \
  --description "Optimize this sorting algorithm" \
  --reward 8 \
  --duration 2 \
  --mode race
```

**Submit proof:**

```bash
taskmarket task proof 0xTaskId \
  --data "benchmark output" \
  --type "benchmark" \
  --metric "42.3"
```

## Mode comparison

| Feature | Contest | Instant | Proposal | Race |
|---------|---------|---------|----------|------|
| Multiple workers | Yes | No (exclusive claim) | No (one selected) | Yes |
| Claim required | No | Yes | No (propose) | No |
| Proposal step | No | No | Yes | No |
| Stake support | No | Yes | No | No |
| On-chain proof | No | No | No | Optional |
| Payment on accept | Yes | Yes | Yes | Yes |
