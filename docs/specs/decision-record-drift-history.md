# Decision-record drift history and check scope

> Version: 0.2 | Date: 2026-08-19 | Status: Draft
> **Implements ADRs:** ADR-0094 (§1, §2)

## Purpose

Two gaps left open by the record work on this branch (ADR-0082, ADR-0083, ADR-0084). Both are about
what the tooling can *tell you*, not about what it validates — the checks themselves are in good
shape.

1. **Drift has no history.** `adr-audit` reports the current drift count and nothing else. "ADR-0042
   is drifting" cannot be turned into "ADR-0042 has been drifting for six weeks." The audit's output
   is written to `docs/adr-audit/`, which is gitignored — correctly, see Design — so there is
   nothing to compare a run against, and no way to tell a new alert from a long-standing one by
   looking at it.

2. **The audit does not say what it examined.** Its JSON carries `driftCount`, `graceCount`,
   `commentViolationCount` and `failOnDrift`, but no count of records examined and no description of
   the scope it ran against. `"driftCount": 0` is the same statement whether the audit swept the
   whole corpus or matched nothing at all. The other checks on this branch report `filesExamined`
   and a `scope` object; the audit is the one that does not.

A third, smaller point, recorded because it is a discoverability difference rather than an
enforcement gap: `adr-lint` runs in CI through `make ci-quality-js`'s `turbo lint:check`, not as a
step in the `adr` job. It is genuinely enforced — a failure fails that job — but a reader of the
`adr` job cannot see that the structural linter runs, and would reasonably conclude it does not.

## Design / Architecture

### 1. A drift age, computed at report time

When the audit reports a record as drifted, it also reports **how long the stated claim has held its
current value**:

```text
ADR-0042: stated 'Implemented' but computed 'Verified'
          stated value unchanged since 2026-07-29 (21 days)
```

The date comes from this repository's own history of that file, resolved for the records already
flagged and only those. A clean corpus performs no lookups; a run with three alerts performs three.
That is what makes this affordable where replaying the corpus is not.

**What the number means, exactly.** It dates the *claim*, not the drift. Drift begins at the later
of the claim being set and the evidence changing, so the interval is an **upper bound** on how long
the disagreement has existed. The wording says "stated value unchanged since" rather than "drifting
for" because the tool cannot honestly say the second.

The search must be `git log -G` over the field's list item, not `git log -S`. `-S` counts
occurrences of a string, and editing a field's *value* leaves that count unchanged — it would skip
exactly the commits being looked for and return the commit that introduced the field, presenting a
record's creation date as the age of its current claim.

**Fail soft.** If the history cannot be read — a shallow clone, a record not yet committed — the
alert is reported without an age. An unavailable age is never a reason to withhold the finding.

**Why not an append-only ledger.** A tracked `docs/adr-audit-ledger.md`, appended one line per run,
was the first design and does not work here.

The job that runs these checks declares `contents: read` (`.github/workflows/ci.yml`). A ledger step
in it cannot write to the repository at all. Widening that job's token to `contents: write` to let a
reporting step commit a log is a poor trade: it grants every step in the job the ability to write to
the repository, in exchange for a convenience feature. And a ledger step that silently fails to
append is worse than no ledger, because a gap in the history reads as an absence of drift rather
than as an absence of data.

There is a second problem, independent of permissions. `--fail-on-drift` runs in CI and in
`.husky/pre-commit`, so drift blocks the merge. The default branch is therefore drift-free by
construction, and a per-run series recorded there is a column of zeros — the ledger's own example
above shows a `1` on a line that this repository's gate would not have allowed to land. The
information worth having is not the state on the default branch but the **event**: drift caught,
drift resolved, and how long the claim stood. The age above is that, computed on demand, with no
write path to go stale or to fail silently.

### 2. The audit reports what it examined

The audit's JSON gains the same shape the other checks on this branch already emit:

```json
{ "status": "ok | warn | error | not-run", "driftCount": 0, "filesExamined": 84, "blocking": false, "scope": { "source": "tracked-sweep", "base": null } }
```

The field is `filesExamined`, the name `adr-lint` and `spec-lint` already use, and the vocabulary is
theirs too. The audit currently reports `drift | clean`, a private vocabulary that forces a consumer
reading all three results to know which tool produced which. `status` says what was found; whether
that fails a build is the caller's choice and lives in `blocking`, so drift is a `warn` here even
when `--fail-on-drift` turns it into a failing exit.

`status` becomes `not-run` — never `ok` — when nothing was examined. A zero finding count is
otherwise the same statement whether the tool swept the corpus or matched no files, and stdout is
the channel an agent reads.

### 3. Make the linter visible in the `adr` job

Add a named step running `lint:check` in the `adr` job. `turbo lint:check` in `ci-quality-js` keeps
running — this is not about adding enforcement, it is about a reader of the governance job being
able to see which governance checks run.

## Interfaces / Contracts

**`adr-audit.ts`** reports a drift age alongside each drift alert. No new flag, no new file, and
no write path: the age is derived on every run that has something to report it for.

**The history lookup lives behind its own seam**, taking a repository root as an argument rather
than reading a module-level constant, so it can be exercised against a purpose-built repository.
A test that can only run against the shipped corpus cannot pin the dates it asserts on.

**Formatting stays a pure helper in `lib.ts`**, testable without a repository at all: given a date
and an evaluation date, produce the sentence. Both inputs are validated as real calendar dates —
`Date.parse` rolls `2026-02-30` forward to March 2, which would turn a malformed date into a
plausible age rather than no answer.

**JSON contract** as in Design §2; existing fields are unchanged and additive.

**CI**: one new step in the `adr` job for the linter. Nothing is committed by CI.

## Testing & Verification

- Against a purpose-built repository, three commits that change only the `Embodiment` value resolve
  to the date of the last one. Under `-S` this same case resolves to the first, so the test fails
  against the wrong implementation — which is what makes it worth having.
- A commit that rewrites surrounding prose without touching the field does not move the date.
- An impossible date (`2026-02-30`, `2026-13-01`) yields no age rather than a plausible one; a real
  leap day (`2028-02-29`) still yields one.
- Outside a repository, or for a number with no matching record, the age is absent and nothing
  throws.
- The audit reports `filesExamined` matching the corpus size, and `not-run` when it examines nothing.
- The `adr` job's log shows the linter running as its own step.

**Applies to every check here:** a result that reports zero findings must also report what it looked
at, or it cannot be distinguished from a run that looked at nothing. That is the same rule this
branch's other checks already follow, applied to the one that does not.

## Non-goals

- **A stored drift history of any kind.** See Design §1 — the permissions it needs are not available
  to the job that would write it, and the series it would record is flat by construction.
- **Tracking the generated report.** It is derived output whose write shape does not
  survive concurrent branches.
- **A trend view** (drift over time, mean time-to-resolution). Possible once entries exist; not built
  here.
- **Changing what counts as drift.** Grace-window `Realized by` mismatches stay non-drift.
- **Moving `turbo lint:check` out of `ci-quality-js`.** The linter stays enforced where it is; §3
  only adds visibility.

## References

- ADR-0082, ADR-0083, ADR-0084 — the record work on this branch that this spec follows.
- `packages/adr/adr-audit.ts` — `--fail-on-drift`, and where the drift age is reported.
- `packages/adr/lib.ts` — where the age formatting belongs.
- `packages/adr/spec-lint.ts` — the one check with no machine-readable channel at all.
- `.github/workflows/ci.yml`, `Makefile` (`ci-quality-js`) — the CI surface §3 changes.
- `.gitignore` — the `docs/adr-audit/` exclusion this spec deliberately keeps.
