---
description: Draft a new RFC from the current conversation and file it under docs/rfc/
argument-hint: [what you're proposing]
---

Draft a new RFC documenting the proposal: $ARGUMENTS

If no topic was given, use the design discussion already in this conversation — do not ask the
user to restate it.

## Process

1. **Extract the proposal from context already in this conversation** — the problem being solved,
   the options actually discussed (not invented ones), and any open questions the user raised or
   that are genuinely unresolved. Do not pad with options nobody considered.

2. **Get the next RFC number:**
   ```bash
   ls docs/rfc/[0-9]*.md 2>/dev/null | sort -V | tail -1
   ```
   Increment the highest existing number by 1, zero-padded to 4 digits (e.g. `0005` → `0006`).
   **This is a local view** — another in-flight branch may already have claimed that number, which
   only shows up once both are in one tree. Check open PRs before assuming it is free.

3. **Write `docs/rfc/NNNN-slug.md`** using `docs/rfc/_template.md`'s exact section shape:
   ```markdown
   # NNNN — <Title>

   - **Status:** Draft
   - **Date:** <today, YYYY-MM-DD>
   - **Author:** <the human's name if known from context, else "Claude Code (drafted for review)">
   - **Supersedes / Superseded-by:** —

   ## Summary
   ## Motivation
   ## Proposal
   ## Open questions
   ## Non-goals
   ## References
   ```
   - **Summary**: one paragraph, plain terms.
   - **Motivation**: the actual problem/opportunity from the conversation.
   - **Proposal**: the real proposal. If multi-phase or has cheap/low-risk pieces vs. real
     commitments, tier or section it so a reader can tell them apart.
   - **Open questions**: genuinely unresolved things, not rhetorical ones.
   - **Non-goals**: what this explicitly does NOT propose, to bound scope.
   - **References**: link related specs/ADRs/PRs — but **verify each one exists before citing
     it**: `ls` the spec/ADR path, `gh pr view <n>` the PR number. A reference to a file that
     turns out not to exist is worse than no reference — RFCs have no structural lint (unlike
     ADRs), so nothing else will ever catch a dangling citation here.

4. **Don't cite an ADR or RFC from a published path.** Per ADR-0084, a decision reference under a
   path in `.adrrc.json`'s `publishedPaths` is a pointer that package's external readers cannot
   resolve, and it fails the audit.

5. **Stage the file, then validate it — in that order:**
   ```bash
   git add docs/rfc/NNNN-slug.md
   cd packages/adr && npx tsx adr-lint.ts && npx tsx citation-check.ts
   ```
   **Order matters and the failure is silent.** Discovery is git-scoped: an untracked file is
   invisible to these tools, so running them first reports clean against a corpus that never
   included the new file. RFCs get no structural lint of their own beyond index freshness, so the
   citation check is the only thing standing between a dangling reference and a merged document —
   run it rather than leaving it to CI, and confirm it actually examined the new file.

6. **Do not write to `docs/specs/`** — that directory holds already-decided, being-built specs,
   not proposals. `docs/rfc/` is a proposal awaiting comment; see `docs/rfc/README.md`.

7. **Regenerate the index** (the file is already staged from step 5):
   ```bash
   cd packages/adr && npx tsx adr-audit.ts
   ```
   The index tool only discovers files that are git-tracked *or staged*
   (`resolveGitTrackedOrStagedFiles` in `packages/adr/lib.ts`) — a brand-new untracked file is
   invisible to it. Running the audit before staging doesn't error, it just silently omits the
   new RFC from `docs/rfc/README.md`/`index.yaml`, which looks like success. Also note `tsx` only
   resolves from `packages/adr`'s own `node_modules/.bin` (pnpm per-package hoisting) — running it
   from the repo root fails with `tsx: command not found`, not a useful error about the real
   problem. Never hand-edit the list between the `RFC-INDEX:START`/`RFC-INDEX:END` markers.

8. **Report back**, don't just silently write the file: state the file path, and summarize the
   Summary/Proposal so the user can immediately tell you whether it captured the discussion
   correctly before they read the full document.

## Rules

- **This is a proposal, not a decision.** Never write `Status: Accepted` — that only happens
  after real discussion; leave it `Draft`.
- **Don't invent options that weren't actually discussed** just to hit a "2-4 options" quota —
  if only one real approach came up, say so in Proposal rather than padding Considered options
  with straw alternatives.
- **Never auto-commit.** Per this repo's Git/GitHub conventions, draft and surface the file;
  committing is a separate, explicitly-requested action.
- **When an RFC section later gets built**, that decision gets its own ADR (`/adr`), which may
  reference this RFC — the RFC's own `Status` then moves toward `Accepted` or `Superseded`, but
  that's a separate, later step, not part of this command.
