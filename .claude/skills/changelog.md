# Changelog Writing Skill

## Purpose

Write or update `CHANGELOG.md` entries that are accurate, user-focused, and consistently formatted. A changelog is for users and integrators — not for developers reviewing commits.

---

## Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with [Semantic Versioning](https://semver.org/):

```markdown
## [version] — YYYY-MM-DD

### Added
- Short, present-tense description of new capability. Include command syntax or flag names where applicable.

### Changed
- Description of changed behaviour. Call out any migration required.

### Deprecated
- Features still working but scheduled for removal. State the replacement.

### Removed
- Features that are gone. State the replacement if one exists.

### Fixed
- Description of bug fixed. Focus on the user impact, not the root cause.

### Security
- Vulnerabilities addressed. Be specific about the attack surface.
```

Rules:
- Only include sections that have entries — omit empty sections entirely.
- One bullet per change. No sub-bullets unless the change has a critical caveat.
- Write from the user's perspective: what they can now do, or what stopped working.
- Use present tense for Added/Changed: "Add X", "Change Y to Z" (not "Added" / "Changed").
- Use past tense only in Fixed: "Fix crash when…".
- Prepend new versions at the top of the file. Never edit old entries.
- Link to issues, PRs, or docs where relevant: `([#123](url))`.

---

## Semver guidance

| Change type | Version bump |
|---|---|
| New commands, flags, or output fields that don't break existing usage | Minor (0.x → 0.x+1) |
| Removing commands/flags, renaming output fields, changing exit codes | Major (x.0.0) |
| Bug fixes, performance, documentation | Patch (0.0.x) |
| First stable public API | 1.0.0 |

---

## What belongs in a user-facing changelog

**Include:**
- New CLI commands, flags, or API endpoints that users call directly
- Changes to command output format or field names (breaking or not)
- New authentication requirements or payment flows
- New on-chain features users interact with (modes, evaluators, hooks, payouts)
- Removal of flags or commands (always breaking — call out explicitly)
- Security fixes that affect how users authenticate or protect funds

**Exclude:**
- Internal refactors (e.g. "migrate to Diamond proxy") — the proxy is invisible to users
- Library upgrades unless they change user-visible behaviour
- CI/CD pipeline changes
- Test additions
- Code quality improvements (linting, formatting)
- Infrastructure changes the user never sees
- Internal error message rewording that doesn't change the user's action

---

## Process

1. Read the current `CHANGELOG.md` to understand the existing version and format.
2. Review git log or diff since the last changelog version to identify user-facing changes. Focus on `apps/cli/src/commands/`, API route additions, and schema changes.
3. Group changes into Added / Changed / Removed / Fixed / Security.
4. Determine the correct semver bump.
5. Write the new entry at the top of the file, above the previous version.
6. Do not rewrite or reformat existing entries.

---

## Example entry

```markdown
## [1.0.0] — 2026-05-30

### Added
- `task cancel <taskId>` — cancel an open task and refund the escrowed reward (0.001 USDC via X402). Not available once a worker has been assigned.
- `task update <taskId>` — update an open task's reward, deadline, description, or tags (0.001 USDC via X402).
- `task accept-submissions <taskId> --winner <addr:share> ...` — pay multiple winners with explicit basis-point shares (must sum to 10000). For Bounty and Benchmark tasks.
- `task evaluate <taskId> --verdict <approve|reject|partial>` — submit an evaluation verdict as an assigned evaluator.
- `task appeal <taskId>` — appeal an evaluator verdict during the appeal window (worker only).
- `task finalize-verdict <taskId>` — finalize a verdict after the appeal window closes (permissionless).
- `task evaluator-timeout <taskId>` — forfeit an unresponsive evaluator's stake after the evaluation deadline (requester only).
- `task resolve-dispute <taskId> --verdict <approve|partial> --award <addr:amount:rank> ...` — settle a disputed task as the designated dispute resolver.
- `task forfeit <taskId>` — forfeit a Claim-mode task's stake and reopen it for new claims (worker only).
- `task auction-accept <taskId> [--min-price <usdc>]` — accept the current clock price on a Dutch or Reverse Dutch auction task.
- `task create --auction-type <dutch|english|reverse_dutch|reverse_english>` — create an auction task with a specific subtype. Dutch and Reverse Dutch use a price clock; English and Reverse English use open competitive bids.
- `task create --hook <address>` — attach an `ITMPHook` contract to a task for custom access control or lifecycle callbacks.
- `task create --evaluator <address>` — assign an evaluator at task creation time.

### Changed
- `task create --auction-type reverse_dutch` requires `--auction-start-price` (the floor price that the clock ascends from).
```
