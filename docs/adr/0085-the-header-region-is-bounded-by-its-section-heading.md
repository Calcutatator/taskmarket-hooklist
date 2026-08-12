# 0085 — The header region is bounded by its section heading, not by contiguity

> **Decision (Y-statement):** In the context of ADR-0083's header parser, which defines the header
> as the first contiguous run of metadata lines carrying `Status`, facing two shapes that rule gets
> wrong — a header interrupted by a dated correction block, and a value wrapped onto more than one
> line — we decided to bound the header by the first section heading below the signature key and to
> attach continuation lines for as long as a field's value continues, to achieve a region rule that
> matches how records are actually written, accepting that any metadata-shaped line above the first
> heading is now treated as a field.

- **Status:** Accepted
- **Date:** 2026-08-12
- **Accepted:** 2026-08-12
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0083

## Context

ADR-0083 replaced two positional heuristics with a shape-based rule: the header is the maximal
**contiguous** run of metadata-shaped lines carrying the signature key `Status`. That rule is right
about anchoring and wrong about where the region ends, in two ways this corpus demonstrates.

**A blank line inside a header does not end it.** A record may carry a dated correction block
between its metadata lines, with roles and relationship fields below the gap. Under a contiguity
rule those fields vanish, and the linter then reports that an `Accepted` record recorded no
`Deciders` — a true-looking error about a record that is completely fine. No record here has that
shape today; the rule is being fixed before one does, because the failure is convincing enough to
be acted on wrongly.

**A value may wrap onto more than one line.** Five records in this corpus wrap a header value
across two or more continuation lines, including ADR-0056, whose `Realized by` value carries a
third locator on a second continuation line. A rule that attaches only the first continuation drops
the rest — and for `Realized by` specifically, that means the audit computes embodiment from a
locator set it never knew was incomplete, then reports a confident result while never checking that
path. Silent, and in the direction that produces false confidence rather than a false alarm.

Both are region-boundary questions rather than anchoring questions, so ADR-0083's anchor stands and
only its terminator changes.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Bound at the first section heading below the signature key; attach continuations while a value continues** | Handles both shapes; the anchor from ADR-0083 is unchanged | Any metadata-shaped line above the first heading is now a field, so a genuinely non-field bullet placed there is reported as an unknown key |
| Keep contiguity, and forbid blank lines inside a header (rejected) | No parser change | Forbids a shape records legitimately use, and would need a migration plus a rule nobody would remember. It also does not fix the wrapped-value truncation |
| Attach a continuation only after a field line (rejected — this is the bug) | Prevents an indented line after a gap being swallowed | Truncates every value wrapped onto more than one line, silently, including realization locators |
| Bound at the first heading anywhere in the document (rejected) | Simpler | That is ADR-0083's rejected positional slice: a heading above the metadata truncates the header to nothing |

## Decision

**The header runs from its first metadata line to the first `## ` heading below the signature key.**
Blank lines, blockquotes and prose inside that region do not end it; every metadata-shaped line in
it is a field.

**A continuation line attaches while the parser is still inside a field's value.** A field line
opens a value; a blank line, a blockquote or prose closes it without ending the header. This keeps
both properties at once: a value wrapped over several lines is captured in full, and an indented
line appearing after a gap is not swallowed into the field above it.

The signature-key anchor, the closed key set, the one-occurrence rule and the no-header error from
ADR-0083 are unchanged.

## Consequences

**Positive:**

- A wrapped `Realized by` value keeps every locator, so the audit checks the evidence the record
  actually names. This is the concrete correctness gain — the others are about false alarms.
- A record with a correction block in its header parses correctly rather than appearing to have no
  roles.
- Both properties are tested directly, which the previous rule's tests did not cover: no test
  exercised a two-line wrap, and the five records that use one fail no check when truncated — they
  simply carry less.

**Negative / trade-offs:**

- Any metadata-shaped line above the first section heading is now a field, so a non-field bullet
  placed there is reported as an unknown key rather than ignored. That is a loud failure rather
  than a silent one, which is the right direction, but it is stricter than before.
- The region can now span a blank line, so a record that opens with an unrelated `- **Key:** value`
  bullet far above its real metadata would pull it in. The signature-key anchor limits this to
  lines contiguous with `Status`, but it is no longer impossible.

**Neutral / follow-up:**

- The rule is measured against this corpus, not proven in general. The corpus test asserting every
  record's header is closed is what would catch a future shape it gets wrong.

## References

- ADR-0083 — the header parser this amends; its anchor and closure rules are unchanged.
- `packages/adr/lib.ts` — `parseHeader`, `headerBoundary`, `collectHeader`.
- `docs/adr/0056-create-task-takes-the-evaluator-configuration.md` — a `Realized by` value whose
  third locator sits on a second continuation line.
