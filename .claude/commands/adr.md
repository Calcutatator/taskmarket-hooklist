---
description: Record a decision that has already been made as an ADR under docs/adr/
argument-hint: [the decision that was made]
---

Record this decision as an ADR: $ARGUMENTS

If no topic was given, use the decision already made in this conversation — do not ask the user
to restate it. This command is for a decision that has **already been decided** (an RFC discussed
and resolved, or a call made directly in conversation) — if it's still an open proposal awaiting
comment, use `/rfc` instead, not this.

## Process

1. **Extract the decision from context already in this conversation**: the concern that forced a
   choice, the options that were genuinely considered (including at least one that was rejected —
   real, not invented), and the choice actually made with its real justification.

2. **Get the next ADR number:**
   ```bash
   ls docs/adr/[0-9]*.md 2>/dev/null | sort -V | tail -1
   ```
   Increment the highest existing number by 1, zero-padded to 4 digits. **This is a local view.**
   Any other in-flight branch that took the same number produces a duplicate on merge, and any
   number claimed by an unmerged branch shows here as a gap. `adr-lint.ts` reports duplicates as
   errors and gaps as warnings, but only once both sides are in one tree — so if several branches
   are open, check the open PRs before assuming the next number is free.

3. **Write `docs/adr/NNNN-slug.md`** using `docs/adr/_template.md`'s exact section shape and
   header fields — Y-statement, Status, Date, Accepted, Embodiment, Last audited, Author, Reviewers,
   Deciders, Supersedes/Superseded-by, Amends/Amended-by, Context, Considered options (at least
   one rejected alternative), Decision, Consequences (Positive/Negative/Neutral), References.
   - **Status:** `Proposed` — never self-set to `Accepted`. Per `docs/adr/README.md`, an ADR
     requires explicit human approval and an external reviewer ack before it can become
     `Accepted`; an agent may draft one but may not self-approve it.
   - **Accepted:** omit the field entirely. It records the date a Decider accepted the ADR, so
     writing one on a `Proposed` draft asserts an approval that has not happened — the same
     self-approval this command forbids for `Status`, in a field that looks more like
     bookkeeping than a decision. `adr-lint.ts` blocks an `Accepted:` date on a non-accepted
     Status, so this fails the build rather than passing quietly.
   - **Embodiment:** `Not started` unless code/tests realizing this decision already exist in
     this same session's diff — if so, still leave it `Not started` and let the next
     `adr-audit.ts` run compute the real value from actual `Implements:`/`Verifies:`
     back-pointers, rather than asserting a value by hand. See `docs/adr/README.md`'s Embodiment
     section — never guess this field.
   - **Author:** the human's name if known from context, else "Claude Code (drafted for review)".
   - **Reviewers / Deciders:** leave as placeholders naming who needs to review/decide — do not
     fill in a name that hasn't actually reviewed or decided yet.
   - **References:** link the RFC this decision came from, if one exists (`docs/rfc/NNNN-*.md`) —
     verify the path actually exists (`ls`) before citing it, same for any other spec/PR cited.
     `adr-lint.ts` catches a dangling *ADR-NNNN* cross-reference, but not a dangling file path.

4. **Use exactly the template's header keys — no others.** Per ADR-0083 the header is a closed
   structure: `adr-lint.ts` blocks an unrecognized key, a duplicated key, and a header it cannot
   find, naming the key and line. If a fact seems to need a new field, that is a schema change and
   wants its own ADR — adding a plausible-looking key to one record is the exact failure ADR-0082
   and ADR-0083 exist to prevent, and it looks authoritative to the next reader while no tool reads
   it. An `x-` prefix is the only escape hatch, for a deliberate local extension.

5. **Don't cite an ADR from a published path.** Per ADR-0084, any `ADR-NNNN` reference under a path
   in `.adrrc.json`'s `publishedPaths` is a pointer that package's external readers cannot resolve,
   and it fails the audit. If the decision needs explaining there, inline the reasoning instead.

6. **Stage the file, then validate it — in that order:**
   ```bash
   git add docs/adr/NNNN-slug.md
   cd packages/adr && npx tsx adr-lint.ts
   ```
   **Order matters and the failure is silent.** Discovery is git-scoped (`resolveGitTrackedOrStagedFiles`
   in `packages/adr/lib.ts`): an untracked file is invisible to the linter, so running it first
   reports a clean corpus that never included the new record. Confirm the run's file count includes
   it rather than trusting the exit code. Writing the file is not the same as it passing — fix what
   the linter reports rather than leaving it for CI, and never report success on a file that was
   never examined.

7. **Regenerate the index** (the file is already staged from step 6):
   ```bash
   cd packages/adr && npx tsx adr-audit.ts
   ```
   The index tool only discovers files that are git-tracked *or staged*
   (`resolveGitTrackedOrStagedFiles` in `packages/adr/lib.ts`) — a brand-new untracked file is
   invisible to it, and running the audit before staging silently omits the new ADR from the
   index instead of erroring. `tsx` also only resolves from `packages/adr`'s own
   `node_modules/.bin` — running it from the repo root fails with `tsx: command not found`.

8. **Report back**: state the file path, the Y-statement, and explicitly flag that `Status:
   Proposed` needs a human Decider + reviewer ack before it can move to `Accepted` — don't let the
   user assume drafting it is the same as deciding it.

## Rules

- **Never self-approve.** This command drafts; it never sets `Status: Accepted`, never writes an
  `Accepted:` date (ADR-0082 makes that a blocking error on a `Proposed` record, deliberately —
  an acceptance date reads like bookkeeping but asserts an approval), never fills in a real name in `Deciders` that hasn't actually decided, and
  never hand-sets `Embodiment` to anything but `Not started` for a fresh ADR.
- **Don't invent a rejected alternative** if none was actually discussed — ask, or note the gap,
  rather than fabricating one just to satisfy the "at least one rejected option" requirement.
- **Never auto-commit.** Draft and surface the file; committing is separate and explicit.
- **If you're not sure whether this is decided yet or still a proposal, stop and ask** — `/rfc`
  and `/adr` are not interchangeable, and drafting an ADR for something that hasn't actually been
  decided misrepresents it as settled.
