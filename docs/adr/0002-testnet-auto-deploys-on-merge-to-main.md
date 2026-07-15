# 0002 — `testnet` is the default branch; `main` is a manually-updated production mirror

> **Decision (Y-statement):** In the context of the agentic development factory's branch and
> release flow, facing the question of where PRs should land and how code reaches the shared
> testnet and mainnet, we decided to make `testnet` the repository's default branch and PR
> target, with `main` receiving merges only manually from `testnet` once it has been validated
> there, to achieve a real staging step between "code review passed" and "live on mainnet"
> without adding process weight to the common case, accepting that `main` no longer reflects
> the tip of ongoing work and that existing open PRs targeting `main` are not automatically
> retargeted.

- **Status:** Proposed
- **Date:** 2026-07-15
- **Deciders:** (awaiting explicit approval — Beau)
- **Supersedes / Superseded-by:** —

## Context

Before this decision, PRs targeted `main` directly, and Railway's environment naming was
itself confusing: an environment literally named `production` was actually the persistent
shared testnet chain (serving `testnet-market.daydreams.systems`), while the real production
environment was named `taskmarket.io`. There was no branch or CI path corresponding to
"testnet" as a concept at all — `deploy-production.yml` (formerly `deploy.yml`) only deploys
on a `v*` tag to real production, and nothing deployed to the shared testnet automatically.

Separately, `docs/specs/agentic-development-factory-rfc.md` already describes an aspirational
release ladder — preview → testnet → mainnet — with `testnet` as a long-lived branch PRs merge
into and `main` as a production mirror receiving merges only from `testnet`. This ADR is the
first piece of that ladder actually implemented and decided, not merely proposed.

Alongside this decision, the Railway side was cleaned up to match: the misnamed `production`
environment was renamed to `testnet` (already had the correct `testnet-*.daydreams.systems`
domains, so no DNS change was needed), and a stray empty `testnet` environment created during
this same session (with the wrong domain, never actually deployed to) was deleted.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| `testnet` as default branch, PRs target it, `main` updated manually from `testnet` | Real staging step before mainnet; matches the already-written RFC's release ladder; automatic app deploys to testnet are safe (no real money, no owner key) | `main` no longer reflects tip-of-work, which can surprise anyone assuming `main` is where PRs land; existing open PRs still target `main` and need manual retargeting or a merge-forward step |
| Keep `main` as the default branch; testnet only reachable via a manual `git push`/cherry-pick (rejected) | No repo-setting change, no PR-retargeting confusion | Testnet drifts from what's actually been reviewed and merged; no natural "this batch of PRs is now on testnet" checkpoint; contradicts the RFC's already-written design |
| Auto-merge `main` into `testnet` (or vice versa) via a bot on every push (rejected) | Removes the manual merge step entirely | Removes the deliberate checkpoint this decision exists to create; a testnet regression would auto-propagate towards mainnet with no human in the loop |

## Decision

`testnet` is now the repository's default branch (`gh repo edit --default-branch testnet`).
New PRs target `testnet` by default. Merging to `testnet` triggers `ci.yml`'s `quality` job
(now also running on push to `testnet`, not just `main`); once that succeeds,
`.github/workflows/deploy-testnet.yml` fires via a `workflow_run` trigger on `ci.yml`'s
completion (not the same push event CI itself runs on -- checking "did CI pass" on that same
event would race `quality`'s multi-minute runtime and abort every deploy). It deploys
`@taskmarket/backend`, `@taskmarket/frontend`, and `@taskmarket/docs` to the Railway `testnet`
environment (formerly misnamed `production`) — no Anvil, no contract deploy. A testnet
contract upgrade (`make upgrade testnet`) stays a separate, manual, developer-run step,
exactly like mainnet (ADR-0001) — this ADR does not change contract-upgrade custody or
automation, only the app
deploy path and where PRs land.

`main` is updated only by a manual merge from `testnet`, once whatever landed there has been
validated against the real shared testnet chain. From that point, `main`'s tip is what
`make release` (tag) and `deploy-production.yml` deploy to real production, unchanged from
today.

The 13 PRs open at the time of this change (targeting `main`) are not retargeted
automatically — they either get manually retargeted to `testnet`, or merge to `main` as
originally planned and get folded into `testnet` on the next manual merge-forward.

## Consequences

**Positive:**
- A real, exercised staging step exists before mainnet: testnet gets continuous, automatic
  app deploys, giving a live environment that reflects what's actually been merged, not just
  what preview environments showed in isolation.
- Matches the branch/release flow already described in
  `docs/specs/agentic-development-factory-rfc.md`, turning an aspirational design into a
  decided one.
- Contract-upgrade custody is untouched: testnet and mainnet upgrades both stay manual,
  developer-run actions (this ADR only automates the app-code deploy, never contracts).

**Negative / trade-offs:**
- `main` no longer reflects tip-of-work — anyone (human or agent) assuming `main` is where
  active development lives needs to unlearn that.
- The manual `testnet` → `main` merge step is a new human bottleneck, on top of the existing
  manual `make release`/`make upgrade mainnet` steps.
- Existing open PRs targeting `main` are now slightly out of step with the new default and
  need explicit handling (retarget, or merge as-is and reconcile on the next merge-forward).

**Neutral / follow-up:**
- Whether to bulk-retarget the 13 currently-open PRs to `testnet` is a separate, smaller
  decision left to whoever triages them.
- `docs/specs/agentic-development-factory-rfc.md`'s release-ladder section should be updated
  to reference this ADR as the decided implementation of its rung 3/4 description.

## References

- RFC: `docs/specs/agentic-development-factory-rfc.md` (release path section)
- RFC: `docs/specs/agent-preview-environments-rfc.md`
- ADR-0001: `docs/adr/0001-mainnet-upgrades-stay-manual.md` (mainnet upgrade custody, unchanged
  by this decision)
- `.github/workflows/deploy-testnet.yml`, `.github/workflows/deploy-production.yml`,
  `.github/workflows/deploy-preview.yml`
