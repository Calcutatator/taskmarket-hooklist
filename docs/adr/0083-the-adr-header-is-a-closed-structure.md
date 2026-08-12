# 0083 — The ADR header is a closed structure, validated as a whole

> **Decision (Y-statement):** In the context of a linter that validates ADR headers one field at a
> time, facing three separate defects that all reduce to "nothing checks what the header *is* —
> only whether particular fields appear in it", we decided to parse the header as a bounded
> structure with a closed key set, located by anchoring to the metadata shape rather than by a
> positional slice, to achieve a header where an unknown key, a duplicated key, and a body bullet
> impersonating a field are all reportable rather than invisible, accepting that adding a
> legitimately new field now requires an ADR and a code change rather than editing one file.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Accepted:** 2026-08-11
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0082; amended by ADR-0085


## Context

Three defects surfaced in quick succession, all in header handling, all fixed narrowly:

1. A field regex anchored to the list-item shape (`- **Key:** value`) was still satisfied by a list
   item in the **body**, because the body is made of list items too. This corpus contains body
   bullets in exactly that shape — `Precedent:`, `Location:`, `Cost:`, `Migration:`.
2. A **duplicated** header key resolved silently to the first occurrence, so a record could state
   two different values for one field and the linter would report on one of them.
3. An **unknown** header key was silently ignored. The parser reads the keys it knows; anything
   else produces no error, no bad index entry, and no signal — so an invented field sits in the
   record looking authoritative to the next reader, human or agent.

Each was fixed for one field. Every other field still had all three problems, which is the tell:
these are not three bugs but one missing capability. `checkStatusField`, `checkDateField`,
`checkAuthorReviewersDeciders`, the supersession and amendment parsers, and the realized-by parser
each ran their own regex over the **whole document**, so every one of them was exposed to (1).

**The negative space is the part a per-field check cannot express.** "Is `Status` present and
valid?" is answerable field by field. "Is this the header, all of it, and only it?" is not — it is
a question about a region and its closure, and no number of per-field checks adds up to it.

### Why the obvious fix is the wrong one

The natural repair for defect (1) is to slice the header at the first `##` heading. It fixes the
body-bullet case and introduces a worse one, because it defines the header by *position* rather
than by what a header actually looks like.

Any record with a heading above its metadata — a dated supplement placed on top, a summary block,
an amendment note — then has a header slice that stops before the metadata ever begins. Every check
scoped to that slice finds nothing and reports success. Verified directly in this repo: with a
heading inserted above the metadata, the slice collapses to 18 characters. The failure mode is not
a wrong answer, it is silence, on a record nothing validated. A record could carry
`Status: Frobnicated` and pass clean.

That is strictly worse than the bug it replaces: a decoy match produces a wrong value that a
reviewer can notice, while a truncated header produces no output at all.

This repo's previous change (ADR-0082) adopted exactly that middle step — slice at the first `##` — for one
field, which is why this ADR amends it. That is currently safe here only by accident: an early `##`
collapses the slice, but the failure is *loud* rather than silent, because `Status` is still found
by a whole-document regex while the newer field uses the slice. Two inconsistent scoping strategies
disagreeing is what produces the error. Making them consistent — the obvious cleanup — would have
converted a loud failure into a silent one.

Measured before designing: every header in this corpus is a single contiguous run of field lines
with no interior blank lines, 6 records wrap a value onto an indented continuation line, and the
header key set is uniform across all 77 records with no divergence.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Parse the header as a bounded structure with a closed key set** | Expresses "and nothing else"; one parser for every consumer; all three defects become reportable | New field requires an ADR + code change; a corpus with legitimate variance would need an escape hatch |
| Keep per-field regexes, fix each defect per field as found (rejected) | Smallest diff per fix | Already tried three times; each fix covers one field and leaves the rest. Guarantees a fourth instance |
| Slice the header at the first `##` heading (rejected) | Simple; fixes the body-bullet case | Documented to fail silently on any record with a heading above its metadata, which is strictly worse than the bug it fixes |
| Validate against a JSON Schema after converting the header to an object (rejected *for now*) | Declarative; standard tooling | Requires committing to a serialization of the header first, and the parsing problem — *which lines are the header* — is untouched by it. Revisit once the parser exists |

## Decision

**One parser.** `parseHeader(content)` returns `{ found, fields: [{key, value, line}], raw }`. No
check runs its own regex over raw document text; every header-field lookup routes through it or
through `headerText(content)`.

**The region is found by shape, not position.** The header is the maximal contiguous run of
metadata-shaped lines anchored at the first one — field lines plus indented continuation lines
attaching to the field above. A blank line, a heading, or unindented prose ends it. A document with
no such run has **no header**, which is a reported error rather than an empty result.

**The key set is closed.** `KNOWN_HEADER_KEYS` lists every legal key. An unrecognized key is a
blocking error naming the key and its line. An `x-` prefix is the declared escape hatch for a
deliberate local extension, so closure is widened explicitly rather than by accident.

**Each key appears exactly once.** A repeated key is a blocking error, never first-wins.

Closure is checked once, centrally, in `checkHeaderStructure` — individual field checks read the
first value and trust the structure check to have flagged duplication, rather than each
re-implementing it.

## Consequences

**Positive:**

- The failure that motivated this — a plausible-looking invented field that no tool reads — is now
  impossible to land silently. Verified against the real corpus: adding `- **Approved:** ...` to a
  record fails the build with the key and line number.
- The decoy-text exposure is closed for **every** field at once, not just the newest one, because
  `Status`, `Date`, roles, supersession, amendment and realized-by lookups are all header-scoped now.
- A heading above the metadata no longer truncates anything. Verified with the sibling corpus's
  exact layout: `Status: Frobnicated` under a dated supplement is caught, where a positional slice
  would have skipped every check on that record.
- 0 errors across all 77 records — the corpus was already closed, so this is enforcement of an
  existing invariant rather than a migration.

**Negative / trade-offs:**

- Adding a header field now takes an ADR and a code change. That is the intended cost: it is
  exactly the friction whose absence let an invented field appear in the first place.
- `KNOWN_HEADER_KEYS` is a second place the schema is written down, alongside `_template.md` and
  `README.md`, and the three can drift. Not solved here; a generated-from-one-source key list is
  follow-up.
- The contiguous-run rule is measured against this corpus, not proven in general. A record that
  someday separates its header into groups with a blank line between them would silently lose the
  fields below the gap — the same class of failure this ADR exists to eliminate. Mitigated only by
  the corpus test asserting closure across every record, which would catch it on the next run.

**Neutral / follow-up:**

- The RFC-level version of this decision covers profiles with more than one metadata shape (a
  blockquote form and a table form in one corpus). This repo uses one shape, so shape declaration
  is deliberately not built here.
- `_template.md` and `README.md` should eventually generate their field lists from
  `KNOWN_HEADER_KEYS` rather than restating them.

## References

- ADR-0082 — introduced the positional header slice this ADR replaces.
- `packages/adr/lib.ts` — `parseHeader`, `headerText`, `KNOWN_HEADER_KEYS`, `checkHeaderStructure`.
- `packages/adr/lib.test.ts` — including a corpus test asserting every record's header is closed.
