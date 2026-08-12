# 0084 — A published path carries no decision references, and declares its own severity

> **Decision (Y-statement):** In the context of a package that is mirrored to a public repository
> while `docs/adr/` is not, facing a boundary check that ran on every audit and passed every time
> while sixteen citations accumulated behind it, we decided to widen the boundary's detector from
> the two structured back-pointer markers to any `ADR-NNNN` reference and to let the boundary
> declare that its violations block, to achieve a check whose width matches the policy its own
> config already states, accepting that the wide matcher must stay strictly separate from
> embodiment evidence collection and that this cannot be enabled until the existing citations are
> removed from `main`.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Accepted:** 2026-08-12
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —

## Context

`packages/contracts/` is mirrored to a public repository. `docs/adr/` is not mirrored, so an
`ADR-NNNN` reference inside that package is, for every reader of the mirror, a pointer to a document
they cannot open.

The rule was already known and already declared. `.adrrc.json` carried the path glob **and** a
reason string: *internal governance/decision references … don't belong in published source at all.*
`adr-audit` read it and enforced it on every run.

Sixteen references accumulated anyway, across eight decision records, and were removed by hand on a
separate branch.

**The check never failed, and it was never broken.** Its detector is `findCommentAdrRefs` —
`Implements: ADR-NNNN` ∪ `Verifies: ADR-NNNN`. Every one of the sixteen was prose: `(ADR-0026)`,
`see ADR-0028`, `per ADR-0028`, `ADR-0029's own chosen option`. Classified mechanically, **0 of 25
offending lines were in a catchable form.** Not one was ever a candidate.

Three things were permissive, and the failure needed all three:

1. **The detector was narrower than the policy it implemented.** The config's reason says
   *references*; the code matches *markers*. Both are true sentences; only one executes, and nothing
   compares them.
2. **The severity was informational.** Violations printed a count. No flag or config key made them
   block — `--fail-on-drift`, which CI and the pre-commit hook both pass, gates drift only.
3. **A second enforcer would have hardcoded the path.** The natural fix (a test grepping the
   package) re-declares the boundary rather than reading the declaration, so the two can drift.

Worth recording because it is the least obvious part: the catchable form had zero instances for a
reason unrelated to the package being clean. The record-side `Realized by:` pointer exists partly so
this very package never needs `Implements:` comments — so the mitigation for the boundary problem in
the back-pointer direction is exactly what guaranteed the detector for the citation direction would
find nothing. **The blindness presented as a clean bill of health**, and instrumenting "did this
check run" would not have caught it, because it ran.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Widen the boundary detector to any `ADR-NNNN`, and let the boundary declare blocking severity** | Matches the policy the config already states; one declaration, every consumer reads it | Needs a second matcher kept deliberately separate from evidence collection; cannot be switched on until `main` is clean |
| Widen the shared `findCommentAdrRefs` helper (rejected) | One matcher, less code | **Actively wrong.** Embodiment evidence would then include prose: a decision would be marked `Implemented` because someone wrote "see ADR-0042" in a comment. Violation and evidence are different questions about the same text |
| Add a standalone test that greps the package (rejected as the primary mechanism) | Trivial to write; independent of the audit | Re-declares the boundary as a literal, so config and test can disagree; and leaves the audit still reporting a confident zero |
| Leave it warn-only and rely on review (rejected) | No change | Already tried, for the entire life of the boundary. Sixteen references is the measurement |

## Decision

**The detector for a published path is `findAnyAdrRefs`** — any `ADR-NNNN`, in any form. It is a
superset of the marker matcher and exists for one question: *does this file reference a decision
record at all.*

**It is deliberately not `findCommentAdrRefs`, and must never be merged with it.** Evidence
collection keeps the narrow, structured matcher. Same text, same boundary, two questions, two
matchers. The existing ignore-marker convention still applies first, so a fixture that merely looks
like a reference stays exempt.

**Severity is part of the boundary declaration.** `.adrrc.json` gains
`publishedPathViolationsBlock`, defaulting to `false` so that enabling it is a deliberate,
reviewable act. It is set `true` here: these files reach a public artifact, which is not a warn-only
concern.

**The key is renamed** `commentForbiddenPaths` → `publishedPaths`, since the policy was never about
comments. The old key is kept as a fallback so a branch already in flight does not break.

**Merge order matters.** `main` currently carries all 25 references, so this fails until the
citation-cleanup branch lands. This PR merges after it. That is also the strongest available
evidence the check works: it was validated against 13 real files, not a planted fixture.

## Consequences

**Positive:**

- The policy's stated width and its implemented width now match, and the config's reason string
  became the specification rather than a comment beside a narrower rule.
- Blocking is expressible. A boundary that reaches a public artifact can say that failing is correct.
- A second, hardcoded enforcer is unnecessary — the audit already reads the declaration.

**Negative / trade-offs:**

- Two matchers over the same text is more surface than one, and the reason they must stay separate
  is not self-evident from reading either. Both carry comments saying so; that is the only
  protection against a future well-meaning consolidation.
- The wide matcher will flag a legitimate reference in a published path with no way to keep it. If a
  published doc ever genuinely needs to explain a decision, the answer is to inline the reasoning or
  publish the record — not to weaken the check.
- Renaming a config key leaves two names live for a while.

**Neutral / follow-up:**

- No mechanism yet compares a policy's *declared* width against its *matched* width in general.
  This ADR fixes one instance by hand.
- A check that has never produced a finding is currently indistinguishable from a check that
  cannot. Surfacing "never fired" as unverified rather than passing would have caught this.

## References

- `.adrrc.json` — `publishedPaths`, `publishedPathViolationsBlock`, and their reason strings.
- `packages/adr/lib.ts` — `findAnyAdrRefs`, and `findCommentAdrRefs` it must stay separate from.
- `packages/adr/adr-audit.ts` — `scanCode`'s published-path branch.
