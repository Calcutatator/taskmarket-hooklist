# Agentic Development Factory RFC

Status: Draft, no decision recorded yet
Owner: Taskmarket
Last updated: 2026-07-13

This is an RFC: a design proposal for discussion, not a decision record. Once a direction is
chosen, the decision itself belongs in an ADR under `docs/adr/` (see `docs/adr/README.md`).
This document depends on `docs/specs/agent-preview-environments-rfc.md` — it assumes that
work exists and asks a broader question on top of it: what does day-to-day agent-driven
development actually look like, end to end?

## Summary

Preview environments give an agent somewhere safe to work. They don't by themselves define
*when* an agent should start working, *what process* it should follow, or *what it does when
it gets stuck*. This RFC proposes splitting agent-driven development into two distinct
processes — bug fixes and feature additions — with different levels of ceremony, and names
the open problem that neither process actually solves yet: reproducing a real, reported bug
inside a preview environment that starts from a clean, empty state.

## Problem

Not every piece of work deserves the same process. A typo fix and a new task-workflow
primitive shouldn't both require the same upfront design conversation, but right now there's
no written distinction — "how does an agent contribute" is one undifferentiated question.

Two different triggers, two different shapes of work:

- **Bug fixes.** Someone (a user, a teammate, a Discord message) reports something broken.
  The fix is usually narrow and the correct scope is usually obvious once the bug is
  understood. Requiring an RFC here would be pure overhead.
- **Feature additions.** New capability, new endpoint, new contract function, new workflow
  primitive. The scope and shape of the right solution is often *not* obvious upfront, and
  getting it wrong is expensive to unwind once agents and humans are both building on top of
  it.

## Proposed Design

### Two processes, not one

**Bug-fix process** (ad hoc, no RFC required):
1. A report comes in (Discord message, issue, direct instruction) describing broken behavior.
2. An agent is triggered, opens a PR, and gets a preview environment (per the preview-
   environments RFC) to verify its fix against.
3. The agent works unattended inside that environment for ordinary implementation choices,
   pausing only if it hits something that belongs in an ADR (rare, for a bug fix).
4. Normal PR review and merge.

**Feature-addition process** (RFC required):
1. A human writes or approves a spec — an RFC in `docs/specs/` — before implementation starts.
   This is the "spec-first" conversation: what problem, what shape of solution, what's out of
   scope.
2. Once the RFC's direction is discussed and any resulting decisions are recorded as ADRs, an
   agent is handed the spec and implements it in its own PR/preview environment, same as the
   bug-fix flow from that point on.
3. Mid-implementation architectural decisions still pause for an ADR, same as any other agent
   work.

This distinction is a convention, not a hard gate — nothing enforces "you may not open a
feature PR without a linked RFC." It's a norm the team (and agents) are expected to follow,
matching how `docs/adr/README.md` treats the human-approval requirement as the one hard
checkpoint and everything else as expected practice.

### Triggering an agent

Out of scope for this RFC to fully design (see the earlier Discord/cloud-agent conversation
this project grew out of), but the shape is: a message (Discord, or otherwise) describes the
task or bug, a cloud agent is spun up, it opens a PR, and the preview-environment workflow
takes over from there. The trigger mechanism itself is a separate, smaller piece of work.

## Open Problem: reproducing a reported bug

This is genuinely unsolved, not just undecided — worth stating plainly rather than papering
over it with a design that sounds complete but isn't.

A preview environment (per the preview-environments RFC) starts from a completely empty
Postgres and a freshly deployed, empty Anvil chain. A bug report like "task #4821 got stuck in
`submitted` and never paid out" describes a *specific piece of state on the real shared
testnet or production* — that state does not exist, and cannot exist, in a fresh preview
environment. Spinning one up does not, by itself, get an agent any closer to reproducing the
reported problem.

What actually needs to happen is some form of reconstruction: the agent (or a human) has to
turn "task #4821 got stuck" into a sequence of API/contract calls that recreates the same
*class* of state in the fresh environment — same task mode, same sequence of status
transitions, same edge-case timing — well enough that the bug reproduces. That reconstruction
step has no defined process yet.

Candidate directions, none chosen:

- **Ask-for-repro-steps discipline**: bug reports must include (or an agent must elicit) the
  exact sequence of actions that led to the state, not just the symptom. Cheapest, but depends
  on whoever reports the bug being able to articulate that sequence, which they often can't.
- **Reproduction-as-code-first**: before attempting a fix, the agent's first deliverable is a
  script/test that recreates the reported state via the API — effectively a regression test
  authored before the fix. Makes the reproduction itself reviewable and reusable, but adds a
  step to every bug fix.
- **State import from the real environment**: pull the actual (anonymized) task/DB row(s) from
  the shared testnet or production into the preview environment's Postgres, and separately
  replay whatever on-chain calls produced the matching contract state on the fresh Anvil chain.
  Most faithful reproduction, but heavier to build, and importing production data into a
  disposable agent sandbox raises its own questions (what data is safe to copy, whether
  on-chain state can even be replayed deterministically outside of controlled test scenarios).

This RFC does not pick one. It exists to make sure this gap is written down and visible before
the bug-fix process above is treated as solved.

## Non-goals

- Designing the exact agent-triggering mechanism (Discord bot, cloud agent orchestration) —
  tracked as a separate, smaller piece of work.
- Solving the bug-reproduction problem above. It's named here so it isn't silently assumed
  away, not resolved here.
- Making the RFC-required-for-features convention machine-enforced. It's a norm, not a gate.

## Open Questions

- Who/what decides whether a given piece of work is a "bug fix" or a "feature addition" when
  it's ambiguous? No process defined yet — likely defaults to human judgment at PR-open time.
- Does a bug-fix PR ever need to escalate into requiring an RFC mid-flight (e.g. the "narrow
  fix" turns out to require a real design decision)? If so, that's presumably just "stop and
  write an ADR," per the existing ADR process — but worth confirming that's sufficient rather
  than needing a formal escalation path to the RFC track.
- Which of the three reproduction candidates above (if any) is worth prototyping first.

## Next Step

Once discussion settles, record the outcome as an ADR in `docs/adr/`, same as any other
decision from this RFC track.
