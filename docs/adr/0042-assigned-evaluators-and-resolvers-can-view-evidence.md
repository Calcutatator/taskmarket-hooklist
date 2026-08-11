# 0042 — Assigned evaluators and dispute resolvers can view task evidence

> **Decision (Y-statement):** In the context of completing evaluator and dispute workflows in the
> web application, facing private tasks and restricted submissions that currently hide the evidence
> from the people assigned to decide their outcome, we decided to treat the configured evaluator and
> dispute resolver as scoped task participants for direct task and submission reads, to achieve an
> evidence-aware verdict flow without requiring requesters to duplicate role assignment in an
> allowlist, accepting that these roles receive confidential task content solely by being assigned.

- **Status:** Accepted
- **Date:** 2026-08-07
- **Embodiment:** Verified
- **Last audited:** 2026-08-07
- **Author:** Codex
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** ponderingdemocritus — human approval in Conductor on 2026-08-07
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0016 and ADR-0030
- **Pending Amends / Amended-by:** —

## Context

Taskmarket lets a requester configure an evaluator and a dispute resolver. Those roles can already
submit verdicts or resolve a dispute through authenticated, payer-gated backend mutations. A valid
decision requires inspecting the task and its submitted artifacts.

The read authorization model does not currently recognize either role. Private task access is granted
to the requester, claimed or awarded workers, wallet allowlists, and password receipts. Restricted
submission access is granted to the requester, each submission's worker, and the audience allowed by
the task's reveal mode. Consequently, an assigned evaluator or resolver can be authorized to make an
irreversible decision while being unable to read the evidence unless the requester separately adds
the same address to the task allowlist.

That mismatch was discovered while implementing the web evaluator controls. Working around it in the
client would either leak evidence through a new endpoint or present blind verdict controls, neither of
which preserves the existing visibility model.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Treat configured evaluator and resolver as scoped evidence viewers (chosen) | Role assignment and evidence access agree; works for private tasks and every submission mode; no duplicate requester configuration | Assigning either role grants confidential content access; authorization predicates and tests gain two roles |
| Require requesters to allowlist evaluator and resolver separately (rejected) | No change to existing visibility predicates | Easy to misconfigure; valid mutation authority can still exist without evidence access; password-only access does not bind to the decision wallet |
| Support evaluator/dispute UI only for public evidence (rejected) | Small implementation | Creates mode-dependent dead ends after task creation and leaves existing backend roles incomplete |
| Copy evidence into a separate evaluator endpoint (rejected) | Avoids changing general task reads | Duplicates storage and visibility rules, creates a new leak-prone source of truth, and still needs resolver authorization |

## Decision

On 2026-08-07, ponderingdemocritus explicitly accepted this boundary: the currently assigned
evaluator or dispute resolver may read private task content and every restricted submission; the
grant is revoked when the role is cleared, does not enable public discovery, and conveys no
additional mutation authority.

Direct task reads treat the address currently recorded as `task.evaluator` or
`task.disputeResolver` as a scoped participant, alongside the existing requester, assigned worker,
award recipient, allowlist, and password-grant paths. This does not make the task discoverable in
public browse/search surfaces and does not grant any unrelated wallet access.

For submission reads, a matching configured evaluator or resolver can inspect every submission on
that task regardless of `submissionVisibility`, because evaluating or resolving requires comparing
the complete evidence set. The access is derived from the task's current role fields; if a timeout or
other lifecycle transition clears a role, that address no longer receives role-derived access unless
another existing rule still permits it.

The mutations remain governed independently by canonical pending actions, status, deadlines, and
payment preflight. Read access does not imply authority to evaluate, resolve, appeal, settle, or change
the task.

## Consequences

**Positive:**

- Evaluators and resolvers can make evidence-aware decisions on every supported task visibility mode.
- Requesters configure each role once instead of synchronizing role fields and allowlists.
- Existing read-auth, direct-read, and submission-visibility predicates remain the enforcement seam.
- Public discovery and unrelated-wallet visibility do not expand.

**Negative / trade-offs:**

- Assigning an evaluator or resolver becomes an explicit confidential-content grant.
- Visibility tests and batched task context must include the two additional role addresses.
- A requester who chooses an external resolver must trust that address with all submitted artifacts.

**Neutral / follow-up:**

- Product copy should disclose the evidence-access consequence when these roles are configured.
- Dispute-resolution evidence recording remains a separate API/contract concern; this decision only
  governs access to evidence that already exists.

## References

- [ADR-0016 — Submission visibility is an independent axis](0016-submission-visibility-independent-axis-default-public.md)
- [ADR-0030 — Private task access and discovery](0030-private-tasks-both-allowlist-and-password-in-app-invite.md)
- [Action Inbox M6: Complete evaluator, appeal, and dispute actions in the web app](https://github.com/daydreamsai/taskmarket/issues/481)
