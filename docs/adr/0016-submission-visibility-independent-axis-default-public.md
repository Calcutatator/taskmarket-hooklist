# 0016 — Submission visibility is an independent axis from task visibility, defaulting to public and locked in at creation

> **Decision (Y-statement):** In the context of scoping Phase 2 (submission visibility)
> of Taskmarket's visibility work, facing the question of whether submission-level
> disclosure should be modeled as a sub-feature nested inside Phase 3's true-private
> tasks or as its own independent, task-visibility-agnostic setting, and what its
> default and mutability should be, we decided to make `submissionVisibility` a
> separate four-value field (`public` / `reveal_all` / `winner_only` / `never`) that
> applies regardless of whether the task itself is `public`, `unlisted`, or (later)
> `private`, chosen once at task creation and locked in permanently, defaulting new
> tasks to `public` (matching today's exact behavior) with the other three as opt-in, to
> achieve a real fix for the loudest complaint (world-readable submissions on live
> tasks) for whichever requester opts in, with zero default-behavior change and zero
> migration-backfill risk, accepting that a requester who does not know the setting
> exists gets no submission protection and that changing a task's mode after creation
> is out of scope for now.

- **Status:** Accepted
- **Date:** 2026-07-20
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

PR #110 (`docs/rfc/0005-task-visibility-and-submission-visibility.md`) originally nested "submission visibility
mode" inside a single "Phase 2: true private tasks" bucket, reasoning that both needed
the same general read-authentication foundation and so belonged together, and originally
modeled it as a two-step process: a `public`/`private` choice at creation, plus a
separate discretionary reveal decision the requester would make after the task ended
(reveal all / winner-only / never). Working through both points in review surfaced two
corrections:

1. **Task visibility** (can this task be found/viewed at all) and **submission
   visibility** (once a task is viewed, can its submitted work also be seen) are different
   questions. The reveal mechanism does not reference the task's own `visibility` value
   at all — a fully `public`, fully listed task can, and under this decision will be
   free to, still hide its submissions from other workers; conversely a task's
   `visibility` setting says nothing about whether its submissions are gated. The only
   thing the two share is a technical dependency (both need to answer "who is asking"
   on a read, which the codebase cannot do today — see PR #110, "Current state: zero
   visibility controls, zero read auth"). Sharing that dependency justifies sequencing
   the read-authentication build inside whichever phase ships first; it does not justify
   treating submission visibility as a feature of true-private tasks. This decision splits
   what PR #110 called "Phase 2" into two: **Phase 2 = submission visibility** (this
   ADR) and **Phase 3 = true private tasks**, with Phase 2 building the shared read-auth
   foundation and Phase 3 reusing it.
2. **The reveal outcome is better modeled as one locked-in enum than a two-step
   process.** A two-step design (hide now, decide how to reveal later) adds a
   discretionary action and a state transition that has to be built, tested, and
   explained to users. Collapsing it into a single choice made at creation — the same
   moment a requester already sets `visibility`, mode, reward, and every other
   task-shape decision — removes that complexity and gives workers a knowable answer
   upfront ("will my submission ever become visible to competitors, and under what
   condition?") before they decide whether to participate at all.

Separately, today's submissions have no visibility control of any kind — every
`submissions.listByTask` call is a `publicProcedure` returning every artifact's S3
`storageUri` to anyone, on every task, regardless of that task's `visibility`
(`apps/backend/src/routers/submissions.router.ts` ~L577). Unlike a `private`-by-default
design (which would flip behavior for every future task and need an explicit backfill
of existing rows, since a bare column default would otherwise silently gate submissions
on tasks already created under the always-open regime), defaulting to `public` avoids
both problems entirely: it matches every existing row's already-established behavior
exactly, so no backfill is needed, and it matches the same opt-in-only philosophy ADR
0011 already settled for task visibility — privacy is available, never assumed.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Independent `submissionVisibility` field (`public` default, opt-in `reveal_all`/`winner_only`/`never`), chosen once at creation and locked in permanently (chosen) | Closes the actual complaint (copying/homogenisation while a task is live, requester confidentiality) for any task that opts in, regardless of its `visibility`; zero default-behavior change and zero migration-backfill risk, matching ADR 0014's established pattern; workers know the disclosure outcome before deciding whether to submit; no reveal state machine to build, test, or explain | A requester who does not discover the setting gets no submission protection by default, same trade-off ADR 0014 already accepted for task visibility; locked-in-permanently means a requester who picks the wrong mode at creation cannot correct it without a separate future feature |
| Default `submissionVisibility` to a hiding mode (e.g. `reveal_all`), matching the actual complaint the feature exists to fix (rejected — an earlier draft of this decision) | Every task gets some protection without the requester needing to know about the setting | Real default-behavior change for every newly created task; a bare column default would retroactively backfill *existing* rows too (Postgres fills a new column's default into every existing row), silently gating submissions on tasks already created and already treated as unrestricted — exactly the failure mode ADR 0014 avoided for `visibility`; breaks the "every phase is strictly opt-in, default never changes what today's users experience" principle this whole initiative has held to since ADR 0014 |
| Two-step model: a `public`/`private` choice at creation, plus a separate discretionary reveal decision (all/winner-only/never) the requester makes after the task ends (rejected — an earlier draft of this decision) | Gives the requester maximum flexibility, decided with the benefit of hindsight after seeing the actual submissions | Adds a reveal state machine (a discretionary action, a new authorization check for "can this caller trigger reveal now," UI for it) that the four-mode enum accomplishes without; a worker deciding whether to submit cannot know upfront whether their work will ever be revealed, since the requester has not committed to an outcome yet |
| Nest submission visibility inside Phase 3 (true-private tasks only) (rejected — the original PR #110 framing) | Keeps all read-auth-dependent work in one phase/PR | Conflates two independent questions (can you view the task vs. can you view what was submitted to it); makes the fix for the most commonly cited complaint (public submissions) wait on a separate, larger, not-yet-decided product question (should true-private tasks exist at all); a fully public task would get no submission protection until/unless Phase 3 is ever built |
| Allow submission visibility to be changed after creation (rejected for now) | More flexible for a requester who changes their mind | Real complexity regardless of when it's built: a task that already collected submissions under `never` and later flips to `public` raises unresolved questions (do prior submissions retroactively reveal? does it need re-consent from workers who submitted expecting privacy?) that are not simplified by deciding them before there is a concrete implementation to hang them on; deferred as explicit future follow-up work, not solved speculatively now |

## Decision

Submission visibility is governed by its own field, independent of `tasks.taskVisibility`:

- `tasks.submissionVisibility`: `'public'` (**default**), `'reveal_all'`,
  `'winner_only'`, or `'never'` — chosen once at task creation and **locked in
  permanently**. There is no update path; changing a task's mode after creation is
  explicitly out of scope for this decision and left as potential future follow-up work
  if a real need for it materializes.
- `'public'`: submissions are visible to anyone who can already view the task,
  immediately — exactly how every submission behaves today.
- `'reveal_all'` / `'winner_only'` / `'never'`: while the task is active, the requester
  sees all submissions and each worker sees only their own; once the task ends, the
  pre-chosen mode takes effect automatically (all revealed / only the `task_awards`-linked
  winner(s) revealed / nothing ever revealed beyond the requester and each submitting
  worker) — a deterministic lifecycle transition, not a fresh discretionary action.
- This applies regardless of `tasks.taskVisibility` — a `public`/listed task can choose any
  submission visibility exactly the same as an `unlisted` one; a `private` (Phase 3) task's
  submission visibility still governs among whichever invited workers can view it.
- Because the default (`'public'`) matches every existing row's already-established
  behavior exactly, the migration needs no explicit backfill — a plain column default
  is safe here, unlike the rejected `'private'`-by-default alternative above.
- Enforcing a non-`public` mode requires the general read-authentication foundation
  (`ctx.caller`, `optionalAuthProcedure`/`protectedProcedure`) that PR #110's Layer 2
  describes. Phase 2 builds this as part of its own scope; Phase 3 (true private tasks,
  if it is ever separately decided and built) reuses it rather than paying for it again.

## Consequences

**Positive:**
- Closes the loudest real complaint from PR #110's own analysis (worker-to-worker
  copying/homogenisation, requester confidentiality of results) for any task whose
  requester opts in, regardless of whether that task also opts into `unlisted`/`private`
  task visibility.
- Zero default-behavior change and zero migration-backfill risk — the same safe
  migration story ADR 0014 established for `visibility`, extended consistently to this
  new field rather than treated as a special case.
- A worker always knows the disclosure outcome before deciding whether to submit, since
  the mode cannot change mid-task.
- No reveal state machine, discretionary action, or "trigger reveal now" authorization
  path to build — the four-mode enum reduces this to a lookup at read time.
- Sequencing the read-authentication foundation inside Phase 2 makes Phase 3 (true
  private tasks) meaningfully cheaper as a follow-up, rather than each phase separately
  paying for the same foundation.

**Negative / trade-offs:**
- Submission protection is never the default; a requester who does not know to opt in
  gets the same world-readable submissions as today, on every task, indefinitely. This
  places real weight on the CLI flag and web toggle actually being discoverable at
  task-creation time, the same trade-off ADR 0014 already accepted for task visibility.
- Locked in permanently means a requester who picks the wrong mode (or later changes
  their mind about how much transparency they want) has no way to correct it short of a
  future feature. Accepted because building mutability now does not reduce its inherent
  complexity — deciding what happens to already-collected submissions under a changed
  mode is exactly as hard whenever it is built — and there is no concrete need for it
  yet.

**Neutral / follow-up:**
- This ADR does not decide whether Phase 3 (true private tasks) is ever built — that
  remains a separate, open product question per PR #110's "Risks and open questions"
  section.
- Whether `submissionVisibility` should ever become mutable is explicitly deferred, not
  rejected outright — a future ADR would need to resolve the already-collected-
  submissions question above before that could ship.
- CLI, web, and docs/skill coverage for `submissionVisibility` are Phase 2
  implementation scope (PR #110's Layer 5/6/7), not decided by this ADR beyond
  confirming they must exist — a setting a requester cannot discover or control from the
  surfaces they actually use is not really opt-in.

## References

- PR #110 — `docs/rfc/0005-task-visibility-and-submission-visibility.md`, "Phase 2: Submission visibility"
  section
- Issue #183 — Phase 1/2/3 implementation tracker
- ADR 0014 — task visibility stays public by default (the separate, related axis this
  ADR is explicitly not changing, and whose opt-in-only reasoning this ADR extends to
  submission visibility)
- ADR 0015 — Phase 1's `agents.inbox` scoped self-auth (the precedent this phase's
  read-authentication work builds on and generalizes)
