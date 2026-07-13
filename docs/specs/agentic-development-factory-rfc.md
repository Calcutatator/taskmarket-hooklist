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

## Goals

- Define two distinct, written contribution processes — ad hoc bug fixes and RFC-first feature
  additions — so agents and humans both know which ceremony a piece of work requires.
- Make cloud agent orchestration a first-class part of the factory: how agents are spun up,
  handed work, given a preview environment, paused for human decisions, and torn down. The
  trigger surface (Discord message, issue, direct instruction) is the factory's front door,
  not an implementation detail to defer.
- Keep the human at exactly two checkpoints per piece of work: the spec/RFC at the start (for
  features) and ADR approval when an agent hits an architectural decision — everything between
  those checkpoints should be able to run unattended.
- Make the factory's costs (inference and infrastructure) legible and controllable, with model
  strength matched to the judgment density of each phase rather than one global setting.
- Name the problems that are not yet solved (bug reproduction from empty state) instead of
  letting the process documents imply completeness.

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

### Cloud agent orchestration

Orchestration is the connective tissue of the factory: the preview-environments RFC defines
where an agent works, the ADR process defines when it pauses, and this layer defines
everything around those — how an agent comes into existence, gets its assignment, and reports
back. The lifecycle:

1. **Trigger.** A message describes the work — a Discord message ("this task page 500s"), an
   issue, or a human handing over a finished RFC. The trigger carries the work's
   classification (bug fix or feature) or a human assigns it at trigger time.
2. **Spin-up.** An orchestrator starts a cloud agent session (headless, API-billed, per the
   economics section) with the repo, the task description, and the process conventions
   (CLAUDE.md, this RFC, the ADR process) as its operating context.
3. **Workspace.** The agent branches, pushes, and opens a PR — which is also how it acquires
   its preview environment, since the environment is keyed to the PR. The PR is the agent's
   durable workspace and its progress log; there is deliberately no second tracking system.
4. **Loop.** The agent iterates: edit, push, wait for the preview environment to rebuild,
   drive the deployed app (browser or API) against its own Anvil chain and Postgres, repeat.
5. **Pause points.** Architectural decisions produce a `Proposed` ADR and stop that thread of
   work until a human accepts it. Questions that don't rise to ADR level go to the PR thread
   (or back to the triggering Discord thread) as ordinary review conversation.
6. **Teardown.** PR merge or close destroys the preview environment (already handled by
   `preview.yml`) and ends the agent session. Cost attribution for the run, if adopted (see
   economics), lands on the PR before it closes.

What this RFC deliberately does not pick yet: the specific orchestrator (a Discord bot
invoking an agent SDK, a managed cloud-agent product, or GitHub-Actions-triggered headless
runs), and whether one agent handles a task end-to-end or hands off between planning and
implementation tiers. Those choices belong in ADRs once this overall shape is agreed.

### Developer experience

What using the factory actually feels like, stated plainly: **you talk in Discord (or an
issue); work comes back as PRs with live preview URLs.** Three entry paths, all converging on
a PR:

1. **Feature, RFC-first.** A developer drafts the RFC in an attended session with the
   strongest model, it lands in a PR, gets discussed, and its decisions are recorded as
   ADRs. Then a single trigger message — "build `docs/specs/foo-rfc.md`" — spins up a cloud
   agent that reads the RFC, `CLAUDE.md`, and the ADR process, opens an implementation PR,
   receives its preview environment automatically, and loops until done or paused on an ADR.
2. **Bug fix.** A single message describing the symptom. The agent spins up, opens a PR,
   attempts reproduction (see the open problem below), fixes, and requests review.
3. **Tiny feature, RFC skipped.** Identical to the bug path — the trigger message *is* the
   spec. Skipping the RFC is the human sender's judgment call, and the ADR pause is the
   backstop: a "tiny" feature that turns out to need a real architectural decision gets
   caught at the other checkpoint rather than sailing through.

The developer's surface area is deliberately small:

- **Two review moments**: accepting/rejecting ADRs when an agent pauses, and reviewing the
  final PR. Everything between is unattended.
- **One pane of glass**: the PR carries the preview URL comment, the commit-by-commit
  progress, links to any ADRs it spawned, and (if adopted) its running cost.
- **One escape hatch**: pull the agent's branch into a local worktree and continue attended
  on a subscription session at any time — cloud-vs-local is per-task, not structural.

What exists when, honestly tiered:

- **After this PR merges** (plus the two GitHub secrets and one dry-run validation):
  automatic isolated preview environments on every PR. Immediately useful to human
  developers, no agents required.
- **After the testnet/mainnet deployer key split**: automated testnet releases on merge
  (release-path rung 3).
- **After the orchestrator ADR is decided and built**: the Discord trigger itself — the one
  genuinely unbuilt piece between the current state and the full factory.

### Release path: from preview to the persistent chains

Preview environments validate the *content* of a contract change but never the *upgrade
path*. Preview always deploys fresh (`DiamondDeploy`), while the real testnet and mainnet
have live diamonds with accumulated state that are upgraded in place (`DiamondFullUpgrade` —
a live diamond cut, gated by the owner key). A PR can pass every preview check and still
carry a broken upgrade: a storage-layout violation or facet-selector collision only
surfaces when cutting against existing state. The factory therefore needs a release ladder
above the PR loop:

1. **PR preview** (empty Anvil, fresh deploy) — validates the change itself. Already covered
   by the preview-environments RFC.
2. **Upgrade rehearsal** (fork-mode Anvil) — required for any PR touching
   `packages/contracts/**`. Anvil's `--fork-url` gives the preview environment a copy of the
   real chain's current state, and `anvil_impersonateAccount` lets the agent execute the
   upgrade script *as the diamond owner without possessing the owner key*. The agent
   rehearses `make upgrade` against real accumulated state and runs smoke tests against the
   upgraded fork — same preview machinery, forked chain instead of empty chain, still zero
   real keys in the environment.
3. **Merge to main → testnet upgrade.** `make upgrade testnet` against the real shared
   testnet's diamond, followed by testnet smoke tests. This step can be an automated CI job:
   the testnet owner key living in GitHub secrets is acceptable custody risk — provided the
   testnet and mainnet deployer keys are actually split first (the known
   `FORGE_DEV_PRIVATE_KEY` issue; that fix becomes a hard prerequisite here).
4. **Release → mainnet.** `make release` tags; `deploy.yml` already ships app services to
   Railway production on the tag, gated on CI. The mainnet diamond cut stays exactly as it
   is today: a developer runs `make upgrade mainnet` manually from their local machine — no
   CI execution, no agent involvement, no change to owner-key custody. **Decided:** see
   ADR-0001 (`docs/adr/0001-mainnet-upgrades-stay-manual.md`), including the rejected
   alternatives (approval-gated CI, multisig/timelock owner).

Ordering constraint at every rung: contracts upgrade before app code that calls the new
functions deploys. The reverse order serves user traffic against functions that do not exist
yet.

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

## Economics and Execution Substrate

Who pays for the model inference, and where the agents physically run, are not afterthoughts —
they determine which parts of this factory can scale and which are bounded by headcount.

### The two billing shapes that exist

1. **Subscription-bundled local sessions.** A developer running an agent interactively on
   their own machine (Claude Code, Cursor, etc.), billed flat through their own personal or
   team plan. Marginal cost per token is effectively zero, but the capacity is bounded: it
   requires that developer's machine, that developer's account, and (in practice) that
   developer's attention. It cannot fan out to N unattended parallel PRs and it stops when
   the human logs off.
2. **API-metered cloud execution.** Headless agents — GitHub Actions steps, Discord-triggered
   cloud agents, anything unattended — authenticate with an organization API key and pay per
   token. This is the only shape that scales past the number of developers, runs overnight,
   and can drive many preview environments concurrently. Every attempt costs real money, and
   a retry loop that would be free on a subscription is a metered bill here.

There is no third option: unattended cloud work cannot ride on personal subscription
accounts, so the moment an agent is triggered by a Discord message rather than a human at a
keyboard, the organization is paying API rates for it.

### Model tiering by phase

The two processes in this RFC have very different token-economics profiles, and the model
choice should follow the judgment density of the phase, not be one global setting:

- **RFC writing, planning, architectural review — strongest available model.** This work is
  low-volume, high-consequence, and (per the process above) happens with a human in the loop
  anyway. It naturally lives in an interactive local session on a subscription, so using the
  most capable model here costs nothing extra at the margin. Getting a design wrong is far
  more expensive than any inference bill.
- **Implementation loops — mid-tier model, cloud, metered.** The edit/test/deploy-to-preview
  cycle is high-volume and more mechanical. This is where cost-per-attempt multiplies across
  parallel PRs, so it should default to a cheaper tier, escalating to a stronger model only
  when an attempt stalls.
- **Mechanical chores (docs sync, formatting, changelog, dependency bumps) — cheapest tier.**
  High-volume, near-zero judgment.

The corollary: the expensive model plans and reviews; the cheap models grind. A feature's RFC
might be authored with the strongest model in an attended session, then handed to a cheaper
cloud agent for implementation — with the strongest model reappearing only at PR-review time.

### Where the work runs

- **Spec/RFC phase: local, attended, subscription-billed.** Already true today; nothing to
  build.
- **Implementation phase: cloud, unattended, API-billed**, one agent per PR, each against its
  own preview environment (per the preview-environments RFC). This is the part that needs the
  org API key, and it stacks on top of the Railway cost of the preview environments
  themselves — the factory's two metered bills are inference and infrastructure, and both
  scale with the number of concurrent PRs.
- **A hybrid escape hatch worth preserving**: a developer can always pull an agent's branch
  into a local worktree and continue attended on their own subscription (the Cursor
  transfer-to-local pattern). Cloud-vs-local is a per-task choice, not an architecture
  commitment.

### Cost-control questions this raises (open, not designed here)

- A per-PR token budget for unattended implementation agents — what's the cap, and what
  happens when it's hit (pause and ping a human, or escalate model tier and retry)?
- Cost attribution: should inference + infra cost per PR be surfaced on the PR itself (a
  comment, like the preview-URL comment), so the factory's economics stay visible instead of
  accumulating silently on an org bill?
- Who owns/rotates the org API key, and is it scoped per-workflow the way Railway tokens
  should be?
- At what concurrent-PR volume do the metered costs justify more engineering (checkpoint
  reuse, model routing, batching), versus just paying the bill?

## Non-goals

- Choosing the specific orchestrator implementation (which Discord bot framework, which agent
  SDK or managed cloud-agent product, which CI trigger). The orchestration *lifecycle* above is
  in scope; the vendor/implementation choice is an ADR to be made against it.
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
- The cost-control questions under "Economics and Execution Substrate": per-PR token budgets,
  cost attribution on the PR, API key ownership/scoping, and the threshold at which metered
  costs justify optimization engineering.
- When to make the testnet/mainnet deployer key split — a prerequisite for automating the
  testnet rung of the release path. (The mainnet custody question itself is decided:
  ADR-0001, manual and developer-local.)

## Next Step

Once discussion settles, record the outcome as an ADR in `docs/adr/`, same as any other
decision from this RFC track.
