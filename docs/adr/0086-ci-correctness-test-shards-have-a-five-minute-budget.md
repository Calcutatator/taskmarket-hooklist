# 0086 — CI correctness-test shards have a five-minute budget

> **Decision (Y-statement):** In the context of pull-request CI whose successful runs took a
> median 13.6 minutes and whose slowest suites serialized independent work, facing slow feedback,
> unbounded test hangs, and cold contract compilation that legitimately exceeds five minutes, we
> decided to split independently separable correctness tests into parallel shards and enforce a
> non-overridable 300-second budget per shard while measuring compilation, setup and analysis
> separately, to achieve bounded test feedback and actionable timing benchmarks, accepting more
> workflow complexity, greater runner fan-out and an explicit exception for inseparable
> instrumented coverage.

- **Status:** Proposed
- **Date:** 2026-08-14
- **Embodiment:** Not started
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Reviewers:** (pending — no reviewer recorded yet)
- **Deciders:** (pending — required before Status may become Accepted)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

An audit of the previous 500 CI workflow runs found a 13.6-minute median and a 22.2-minute 95th
percentile among successful runs. Contract quality had a 20.4-minute median, JavaScript quality a
12.9-minute median, WebKit end-to-end tests a 12.6-minute median and Chromium end-to-end tests a
9.9-minute median. Several jobs combined independent suites serially, rebuilt the same production
web artifact in every browser job, or had no boundary between a hung test process and a merely slow
one.

The five-minute requirement needs a precise boundary. A **correctness-test shard** is a process
whose primary purpose is executing assertions and which can be timed independently of environment
provisioning or compilation. A shard can contain multiple test cases, but no contained test can run
past the shard's deadline because the whole process group is terminated when the budget expires.
Setup, dependency installation, artifact transfer, compilation, static analysis and report upload
are not correctness-test shards.

Foundry makes one distinction especially important. A clean contract checkout takes more than five
minutes to compile with the repository's optimizer and IR settings, while the warm correctness
suite finishes in seconds. `forge coverage` also performs a fresh instrumented compilation and test
execution as one command; Foundry does not expose a supported boundary at which CI can start a timer
after that compilation but before coverage execution. Treating either cold command as a
five-minute test would reject healthy clean checkouts without identifying a slow test.

Ordinary developer commands have a different purpose from CI policy commands. A local
`make contract test` must remain useful on a cold checkout and therefore cannot inherit a CI-only
deadline. CI-specific targets may rely on an earlier compile step and enforce the test budget after
artifacts are warm.

Finally, parallel matrices make a skipped job ambiguous. A skip can mean that a successful change
detector proved the suite irrelevant, or that an upstream dependency failed before the suite could
start. Aggregate required checks must distinguish those cases rather than treating every skip as a
pass.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Cap each independently separable correctness-test shard at 300 seconds, parallelize shards and measure non-test phases separately** | Gives every test process a hard bound; preserves valid cold builds; exposes per-shard timing; reduces the application-test critical path | Adds matrix jobs, artifact fan-out and policy-specific Make targets; compilation and inseparable coverage remain outside the bound |
| Cap every command that eventually executes tests at 300 seconds (rejected) | Literal and mechanically simple | A valid cold contract checkout exceeds the limit before a test starts; instrumented coverage cannot separate compilation from execution, so the limit measures compiler speed rather than test speed |
| Record durations without failing slow shards (rejected) | Establishes a baseline with no disruption | Provides no guarantee and allows a hung or gradually regressing suite to remain green indefinitely |
| Use only GitHub job-level timeouts (rejected) | Requires no repository-owned runner | Includes checkout, dependency installation, services and artifact transfer in the same clock; does not publish a reusable per-shard benchmark; cannot preserve an unrestricted local command |
| Keep suites serial and raise overall job timeouts (rejected) | Lowest workflow complexity and runner usage | Preserves the slow feedback path and gives no five-minute test guarantee |

## Decision

Every independently separable CI correctness-test shard has a maximum budget of 300 seconds from
child-process spawn to exit. The repository-owned runner rejects any requested budget above 300
seconds, records elapsed time and status in the GitHub step summary, propagates ordinary child exit
codes, marks the shard over budget and sends `SIGTERM` to the entire child process group when the
deadline expires, then escalates to `SIGKILL` after a bounded ten-second cleanup grace. A deadline
failure uses exit code 124 so it is distinguishable from an assertion failure; cleanup time cannot
turn an over-budget shard green.

Suites that cannot reliably complete inside that budget are split into balanced shards and run in
parallel. Shared build work is performed once and distributed as an artifact when consumers require
the same output. The production web build is therefore not repeated by each browser shard.

The budget applies to backend, web, other JavaScript, Storybook, skill-conformance, Chromium,
WebKit and warm contract correctness shards, plus the gas-snapshot check. CI-specific contract
targets enforce the budget after the ABI freshness step has compiled the contracts. Ordinary local
contract test and snapshot targets remain unrestricted.

Dependency installation, environment provisioning, compilation, static analysis and report upload
are separate phases with their own workflow-level safety timeouts and observed durations. Coverage
remains an explicitly labelled analysis exception while Foundry combines instrumented compilation
and execution into one indivisible command. This exception must not be described as satisfying the
five-minute correctness-test-shard guarantee.

Aggregate required checks fail closed. A conditional contract job may count as a valid skip only
when a successful change detector explicitly reports that no contract-affecting input changed; a
failed detector or an unexpected matrix skip cannot produce a green aggregate.

## Consequences

**Positive:**

- A hung test process is marked failed in at most five minutes and its benchmark row identifies the
  shard; process cleanup may use the bounded grace period after that deadline.
- Slow suites can no longer hide behind a generous job timeout that also includes setup.
- Parallel backend, web and browser shards shorten the application-test critical path, while one
  shared production build removes duplicated browser setup work.
- Normal developer contract commands still work on a clean checkout whose first compile exceeds
  five minutes.
- Aggregate checks no longer confuse an upstream failure with a legitimate conditional skip.

**Negative / trade-offs:**

- More parallel jobs increase runner fan-out and can increase billed compute even when wall-clock
  feedback improves.
- Shard balance can drift as suites grow, so a formerly balanced matrix may need repartitioning.
- Foundry compilation and instrumented coverage can still dominate the full contract-quality job;
  this decision bounds test feedback, not every CI phase.
- Artifact upload and download become part of the browser workflow and introduce another failure
  surface.

**Neutral / follow-up:**

- Keep the 300-second ceiling centralized and covered by runner self-tests; changing it is a policy
  change, not an ad hoc workflow edit.
- Review benchmark summaries when adding tests and split a shard before its normal duration gets
  close enough to the ceiling that routine runner variance could fail it.
- Revisit the coverage exception if Foundry provides a supported way to separate instrumented
  compilation from coverage execution.
- Once this ADR is accepted, add implementation and verification back-pointers to the CI runner,
  workflow and runner tests so the embodiment audit can track drift.

## References

- [PR #548](https://github.com/daydreamsai/taskmarket/pull/548) — implementation and adversarial
  review of the five-minute CI benchmark.
- [Hosted CI run 31754372531](https://github.com/daydreamsai/taskmarket/actions/runs/31754372531)
  — all CI jobs and aggregate gates passed; the warm contract shard took 1.5 seconds and the gas
  snapshot 0.6 seconds after a 13-minute cold ABI compile.
- `.github/workflows/ci.yml` — matrices, shared web artifact, conditional contract detection and
  aggregate gates.
- `Makefile` — CI-specific shard targets and unrestricted developer contract targets.
- `scripts/run-ci-test.mjs` — deadline enforcement and benchmark reporting.
- `scripts/run-ci-test.test.mjs` — runner behavior and maximum-budget coverage.
- `apps/web/playwright.config.ts` — deterministic single-worker browser sharding.
