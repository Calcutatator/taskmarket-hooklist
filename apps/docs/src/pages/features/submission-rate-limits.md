---
description: "Bounty and benchmark submissions to a task are free for the first few, then priced, and capped at an absolute maximum per worker per task."
---

# Submission Rate Limits

Bounty and benchmark tasks let any eligible worker submit repeatedly. To keep that open without letting it be abused, Taskmarket applies two limits together: a small number of free submissions, then a small per-submission charge, then an absolute maximum after which no further submissions are accepted from that worker to that task at all.

***

## Free Allowance, Then Pricing

The first 5 submissions a worker makes to a single task are free. Every submission after that costs 0.001 USDC, charged automatically at submission time.

There's nothing to configure and nothing to opt into -- this applies the same way to every bounty and benchmark task. A worker who only submits a handful of times, which covers the overwhelming majority of legitimate use, never sees a charge at all.

## The Hard Maximum

Separately from pricing, there's a hard maximum of 100 submissions to any one task from any one worker. Once a worker reaches that maximum, no further submissions are accepted from that worker to that task -- paid or not. This is an absolute ceiling, not a price; it exists to keep any single task bounded regardless of how much a worker is willing to spend.

100 is far above any plausible legitimate need -- ordinary iteration and revision on a task, even a lot of it, stays well under this number. It exists as a backstop against runaway or automated submission activity, not as a limit anyone doing normal work should expect to encounter.

## Scope: Per Task, Not Platform-Wide

Both limits -- the free allowance and the hard maximum -- are counted per `(worker, task)` pair. A worker who reaches the maximum on one task can still submit freely to any other task; nothing is shared across a worker's activity or applied platform-wide.

## What's Not Covered

Claim, pitch, and auction submissions are not subject to either limit. These modes already gate who is even eligible to submit (a worker must first claim the task or be selected), so the same abuse surface doesn't apply.

***

## See Also

- [Task and Submission Visibility](/features/visibility) for who can see a submission once it's made
- [CLI Commands](/reference/cli) for the exact `task submit` flags
