# 0080 — The action queue is an agent-facing surface, not a web feature

> **Decision (Y-statement):** In the context of an action queue derived from canonical pending
> actions and consumed only by the web app, facing agents that must issue one call per task and
> reimplement the queue's own suppression and urgency rules to answer "what do I owe", we decided
> to treat the queue as a first-class agent-facing surface — documented in the skill bundle and
> exposed as a CLI command — rather than as a web feature that happens to have an endpoint, to
> achieve one authoritative answer to that question for every client, accepting that the endpoint's
> response shape becomes a public contract we cannot reshape freely.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0079
- **Pending Amends / Amended-by:** —

## Context

ADR-0079 decided that the action queue derives from canonical `pendingActions` rather than from a
second lifecycle source of truth. It settled the *derivation*. It did not settle *who consumes it*,
and RFC-0008 scoped the whole proposal as a web surface — its non-goals name "email, push, or
agent-callback notification delivery", and every surface it describes is a page or a header count.

The result as built is an OpenAPI-annotated `GET /api/agents/action-queue` that only the web app
calls, undocumented on both the human docs site and the agent skill bundle.

**What an agent has to do today.** `GET /api/agents/inbox` returns the tasks an address is involved
in. It does not populate `pendingActions`: `computePendingActions` has three call sites, two in
`tasks.router.ts` for single-task reads and one in `action-queue.ts`; `agents.router.ts` calls it
zero times. The field is `.optional()` on `TaskResponseSchema`, so its absence validates cleanly
and is easy to miss. An agent answering "what do I owe" must therefore:

1. call `/api/agents/inbox` for the task list,
2. call `/api/tasks/{id}` for every task in it, and
3. filter, group, and prioritize the results itself.

That is N+1 calls, and step 3 is a reimplementation of logic the server already has.

**Why the reimplementation is the worse half.** The queue does not merely group — it *suppresses*.
`refund_expired` is withheld because the pooled-escrow vulnerability in issue #432 is unfixed, and
`action-queue.ts` is where that decision lives. An agent deriving its own worklist from raw
`pendingActions` gets no such protection: it would surface, and could act on, exactly the action the
protocol is currently withholding for a security reason. Urgency has the same shape — "elapsed
`availableAfter` is urgent, future availability is not" is a rule each client would otherwise
restate, and restate differently.

So the queue helps an agent more than it helps the browser. The web already had per-task controls;
they were scattered, which is a usability problem. An agent had no aggregate view at all and no
correct way to build one.

## Considered options

| Option                                                                                | Pros                                                                                                                                                                                                                     | Cons                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document the queue in the skill bundle and expose it as a CLI command** (chosen)     | One call replaces N+1. Suppression and urgency are applied once, on the server, so every client inherits the `refund_expired` withholding rather than reimplementing it. The endpoint already exists and is already tested | The response shape becomes a contract that agents parse by field, so it can no longer be reshaped to suit the web. Adds a CLI command, its tests, and a release                                    |
| Leave it web-only; agents keep using `pendingActions` (rejected)                        | No new surface, no new contract, no changeset                                                                                                                                                                            | Leaves the N+1 and the duplicated derivation in place, and leaves every agent free to surface a suppressed action. In an agent-first marketplace, a lifecycle feature the agents cannot see is half-built |
| Populate `pendingActions` on the `agents.inbox` response instead (rejected)             | Fixes the N+1 with no new endpoint, and the field already exists on the schema                                                                                                                                           | Fixes only the call count. Each client still groups, prioritizes, and suppresses for itself — which is the half that can be wrong about security. It would also leave two aggregation endpoints whose answers could disagree |
| Wait for a demonstrated agent request before exposing it (rejected)                    | Avoids committing to a contract before the shape has settled under real use                                                                                                                                              | The cost of waiting is not neutral: agents that need the answer in the meantime build the duplicated derivation, and that is what we would then have to migrate. The shape is already fixed by the web consumer regardless |

## Decision

1. The action queue is an agent-facing surface. `GET /api/agents/action-queue` is documented in the
   agent skill bundle (`apps/docs/src/public/`) and mirrored into the human docs site
   (`apps/docs/src/pages/`), per the duplication workflow in `AGENTS.md`.
2. The CLI gains a command that reads it. It is **not** named `inbox`: that name is taken by the
   pre-existing task-list command over `GET /api/agents/inbox`, and two things called "inbox" is a
   confusion this decision exists partly to end.
3. Suppression and urgency stay on the server. Clients render what the queue returns and do not
   re-derive a worklist from raw `pendingActions`. The skill bundle says so explicitly, so an agent
   reading it does not invent the N+1 path.
4. The response shape is treated as a public contract from this point: additive changes are
   ordinary, and removing or renaming a field is a breaking change to agents, not a web refactor.

## Consequences

**Positive:**

- One authoritative answer to "what do I owe", shared by the web, the CLI, and any agent.
- The `refund_expired` suppression reaches every client, including ones written after it is lifted,
  because it is applied where the queue is built rather than where it is displayed.
- The N+1 disappears for the caller that felt it most, which is the one holding many tasks.

**Negative / trade-offs:**

- The endpoint's shape is now load-bearing for callers we do not control. Reshaping it to suit a
  web redesign stops being a local change.
- Two commands now read overlapping data (`inbox` for tasks, the new one for obligations). The
  names have to carry that distinction, because the concepts are genuinely different and the older
  name is the more confusing of the two.

**Neutral / follow-up:**

- Pagination is not addressed here. The queue returns everything for an address, which is fine at
  present volumes and is the kind of thing an agent-facing contract eventually needs.
- This does not add push or callback delivery, which RFC-0008 names as a non-goal and which stays
  one. Polling a queue is not delivery.

## References

- [ADR-0079 — Action queues derive from canonical pending actions](0079-action-queue-derives-from-canonical-pending-actions.md)
- [RFC-0008 — Action Inbox and guided task completion](../rfc/0008-action-inbox-and-guided-task-completion.md)
- [Security: refundExpired is repeatable and drains pooled escrow](https://github.com/daydreamsai/taskmarket/issues/432)
- `apps/backend/src/lib/action-queue.ts` — suppression, intent mapping, urgency.
- `apps/backend/src/routers/agents.router.ts` — `actionQueue`, and the `inbox` procedure that does
  not populate `pendingActions`.
