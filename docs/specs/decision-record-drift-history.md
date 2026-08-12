# Decision-record drift history and check scope

> Version: 0.1 | Date: 2026-08-12 | Status: Draft
> **Implements ADRs:** (none yet — each section names the ADR it needs first)

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

### 1. An append-only drift ledger

Append **one line per run** to a tracked `docs/adr-audit-ledger.md`:

```markdown
| Date | Drifting | Examined | Change since previous run |
|---|---|---|---|
| 2026-08-12 | 0 | 84 | — |
| 2026-08-13 | 1 | 85 | +0042 |
| 2026-08-20 | 0 | 85 | -0042 |
```

Date, drift count, records examined, and **which records started or stopped drifting** since the
previous line. The delta is what makes a line worth reading: a count alone cannot distinguish "the
same alert, still open" from "a different record started drifting today", and that distinction is
exactly what is missing today.

**Why not simply track the generated report.** `docs/adr-audit/report.md` is a regenerated table of
every record. This repository has hundreds of branches, and a large share of them touch `docs/adr/`
— committing a whole-file regenerated table would produce a conflict on nearly every one, in a
*derived* file whose only honest conflict resolution is to re-run the tool. Hand-merging generated
output is meaningless work.

What makes a file committable here is not its size but its **write shape**: two branches that each
append a different line merge cleanly; two that each rewrite the same table do not. That property,
not the content, is the reason the ledger is tracked and the report is not.

**Appended in CI only, on merge to the default branch.** Not in the pre-commit hook: a local commit
attempt is not an event worth a history entry, several commits on one branch would each append one,
and a hook that adds a file to a commit changes what the author is committing without telling them.
One entry per merge is the cadence that keeps the file readable.

The flag is opt-in for the same reason `--fail-on-drift` is: a plain local run must not write to a
tracked file as a side effect of asking a question.

**The delta is replayed, not stored.** "What is drifting now" is the sum of every `+NNNN` minus
every `-NNNN` in order. That is why the file is append-only: reordering or editing a line silently
changes the answer. It is a convention, not a mechanism, and the spec states it rather than assuming
it.

### 2. The audit reports what it examined

The audit's JSON gains the same shape the other checks on this branch already emit:

```json
{ "status": "clean", "driftCount": 0, "adrsExamined": 84, "scope": { "source": "tracked-sweep", "base": null } }
```

`status` becomes `not-run` — never `clean` — when nothing was examined. A zero finding count is
otherwise the same statement whether the tool swept the corpus or matched no files, and stdout is
the channel an agent reads.

### 3. Make the linter visible in the `adr` job

Add a named step running `lint:check` in the `adr` job. `turbo lint:check` in `ci-quality-js` keeps
running — this is not about adding enforcement, it is about a reader of the governance job being
able to see which governance checks run.

## Interfaces / Contracts

**`adr-audit.ts`** gains `--append-ledger`. Ledger path: `docs/adr-audit-ledger.md`, tracked,
distinct from the gitignored `docs/adr-audit/` directory.

**Pure helpers in `lib.ts`, not in the CLI**, so they are testable without running the audit:
replaying a ledger's delta column to a set of drifting numbers, and formatting the change between
two such sets. The CLI keeps only the file read/write.

**JSON contract** as in Design §2; existing fields are unchanged and additive.

**CI**: one new step in the `adr` job for the linter; one new step, guarded to pushes on the default
branch, for the ledger append.

## Testing & Verification

- Replaying a ledger with `+0042, +0062` then `-0042` yields exactly `{0062}`.
- An empty or header-only ledger yields nothing drifting; prose that merely mentions `+0042` is not
  parsed as an entry.
- An unchanged drifting set renders `—`, which reads as "no change", not as "no drift".
- A format round trip is stable: replay a ledger, compute a delta against a new set, append it, and
  replaying the result gives that new set back.
- The audit reports `adrsExamined` matching the corpus size, and `not-run` when it examines nothing.
- The `adr` job's log shows the linter running as its own step.

**Applies to every check here:** a result that reports zero findings must also report what it looked
at, or it cannot be distinguished from a run that looked at nothing. That is the same rule this
branch's other checks already follow, applied to the one that does not.

## Non-goals

- **Tracking the generated report.** See Design §1 — it is derived output whose write shape does not
  survive concurrent branches.
- **A trend view** (drift over time, mean time-to-resolution). Possible once entries exist; not built
  here.
- **Changing what counts as drift.** Grace-window `Realized by` mismatches stay non-drift.
- **Moving `turbo lint:check` out of `ci-quality-js`.** The linter stays enforced where it is; §3
  only adds visibility.

## References

- ADR-0082, ADR-0083, ADR-0084 — the record work on this branch that this spec follows.
- `packages/adr/adr-audit.ts` — `--fail-on-drift` today, `--append-ledger` proposed.
- `packages/adr/lib.ts` — where the pure ledger helpers belong.
- `.github/workflows/ci.yml`, `Makefile` (`ci-quality-js`) — the CI surface §3 changes.
- `.gitignore` — the `docs/adr-audit/` exclusion this spec deliberately keeps.
