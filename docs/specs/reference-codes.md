# Reference codes for submissions and tasks

> Version: 0.2 | Date: 2026-08-17 | Status: Draft
> **Implements ADRs:** ADR-0098
> Depends on: `docs/specs/shareable-ui-state.md` | Feeds into: `docs/specs/marketplace-search.md`

## Purpose

A submission's only identifier today is `submissions.id` — a SHA-256 digest reshaped to look like a
v4 UUID, e.g. `3f9c1a04-77b2-4e15-9d3a-6b8e0c15f2aa`. It is a correct primary key and an unusable
public name: it cannot be read over a call, cannot be typed from a screenshot, and will never appear
in a message someone actually sends. `tasks.id` is chain-derived and citable in a URL, but no more
sayable.

This spec defines a short, stable, quotable code for each — the thing a person points at when they
say "look at this one" — along with how codes are minted, backfilled onto existing rows, resolved,
and displayed.

## Design / Architecture

### Code format

```
SUB-7K2QA9XF     a submission
TSK-4M0BXQ2E     a task
```

- An entity prefix — `SUB-` for submissions, `TSK-` for tasks — so a code is recognizable out of
  context, and so an exact-identifier lookup knows which table to search without trying both.
- Eight characters from **Crockford base32**: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- Canonical form is uppercase. Storage and display always use the canonical form.

Crockford's alphabet is chosen for what it excludes rather than its density. It omits `I`, `L`, `O`
and `U`: the first three because they are indistinguishable from `1`, `1` and `0` in most fonts, which
is the exact failure of a code transcribed from a screen; `U` because dropping it removes most
accidental profanity, which will otherwise eventually appear next to somebody's work.

Eight characters give 32^8 ≈ 1.1 × 10^12 codes per entity. At a million rows the probability of any
collision on a random draw is under 10^-6, and the unique index makes a collision an error to retry
rather than silent corruption.

### Minting

Codes are generated randomly at row-write time and stored. They are not derived from the row's id, its
content hash, or anything else — a value users are expected to write down must be a stored fact, not
the output of an algorithm that might later change.

Generation draws 5 bytes from a CSPRNG and maps them onto the alphabet. Insert relies on the unique
index; on a unique-violation the code is redrawn, up to five attempts, after which the write fails
loudly rather than proceeding without a code.

**Submissions.** Both creation paths in `submissions.router.ts` mint a code — the two call sites that
currently compute `submissionId` via `derivedIdempotencyKey`. Because minting is random rather than
derived, it must happen inside the same insert that is protected by the existing idempotency key, so
an idempotent retry of the same submission returns the original row and its original code rather than
minting a second one.

**Tasks.** A task row is written either by the intent completion that observed the receipt (ADR-0055)
or by a later reconciliation pass over the same `TaskCreated` event (ADR-0029). Minting therefore
belongs to the insert itself rather than to either caller: whichever path inserts the row first mints
the one code, and the other finds the row already present and does not mint. A reconciliation insert
cannot recover off-chain-only creation inputs, but a random code needs no recovery — only a single
owner. The insert is already idempotent on task id, which is what makes this safe.

### Schema and backfill

Two deploys per table, following the ADR-0008 precedent: the column and backfill ship first, the
`NOT NULL` constraint only after the backfill is confirmed against the target database.

**Deploy 1** — additive and idempotent:

```sql
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "reference_code" text;
ALTER TABLE "tasks"       ADD COLUMN IF NOT EXISTS "reference_code" text;

CREATE UNIQUE INDEX IF NOT EXISTS "submissions_reference_code_unique"
  ON "submissions" ("reference_code");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_reference_code_unique"
  ON "tasks" ("reference_code");
```

The backfill assigns a code to every row where `reference_code IS NULL`, which makes re-running it a
no-op rather than a rewrite. It runs as a batched script rather than inline SQL, because it needs the
same CSPRNG draw and retry-on-collision behavior as the write path, and because a single statement
over the whole table would lock it.

**Deploy 2** — once every row in a table has a code:

```sql
ALTER TABLE "submissions" ALTER COLUMN "reference_code" SET NOT NULL;
ALTER TABLE "tasks"       ALTER COLUMN "reference_code" SET NOT NULL;
```

The two tables do not have to reach deploy 2 together; whichever backfill is confirmed first can be
constrained first.

Per `AGENTS.md`, each migration needs a matching `meta/_journal.json` entry whose `"when"` is a fresh
`date +%s000` greater than every entry already on `main` at the tip being merged into — re-stamped
immediately before merge, not when the branch was cut.

### Resolution and normalization

Lookup is forgiving; storage and display are not. Input is normalized before matching:

1. Trim, uppercase.
2. Split a recognized entity prefix (`SUB-`, `TSK-`) if present, and remember which it was.
3. Apply Crockford's documented substitutions to the remainder: `I` and `L` to `1`, `O` to `0`.
4. Reject anything that is not then exactly eight characters of the alphabet.

Step 3 is what makes a code survive being read aloud and typed back by someone who heard "oh" and
wrote `O`.

A code that carried a prefix resolves against that entity only. A prefixless code is resolved against
both tables; a hit in exactly one resolves, a hit in both is reported as ambiguous with both
candidates rather than silently preferring one.

### Routes and surfaces

A short resolver route gives a code its own address:

```
/s/SUB-7K2QA9XF  ->  308  ->  /tasks/<taskId>?submission=SUB-7K2QA9XF
/s/TSK-4M0BXQ2E  ->  308  ->  /tasks/<taskId>
```

The resolver looks the code up, applies the caller's existing visibility permissions, and redirects to
the canonical deep link. It does not render a page of its own — a submission is shown in its task
context, where the surrounding state that makes it meaningful already exists.

The `submission` param is registered per `shareable-ui-state.md` and carries the **code**, not the id.
The code is the public name; the primary keys stay out of user-facing URLs, which also keeps the
idempotency derivation free to change. Task routes keep `taskId` in the path — the code is an
additional address for a task, not a replacement for its canonical URL.

In the UI, the code appears next to each submission and task using the existing `copy-button.tsx`
control rather than a new one, in monospace, at every place the entity is identified: task detail,
task lists and cards, the submission gallery, worker submission history, and `/live`.

An unresolvable code renders a not-found state that says the code was not found and offers search —
distinguishable from a code that resolves to something the viewer may not see, which renders the same
not-found state deliberately, so the route cannot be used to probe for the existence of hidden work.

## Interfaces / Contracts

### Schema additions

```ts
// apps/backend/src/db/schema.ts -- submissions and tasks tables
referenceCode: text('reference_code').notNull(),  // NOT NULL after deploy 2
// (table) =>
referenceCodeIdx: uniqueIndex('<table>_reference_code_unique').on(table.referenceCode),
```

### Generation and normalization

```ts
// apps/backend/src/services/reference-codes.ts
export type ReferenceEntity = 'submission' | 'task';

export function mintReferenceCode(entity: ReferenceEntity): string;   // 'SUB-7K2QA9XF' | 'TSK-4M0BXQ2E'

export function normalizeReferenceCode(input: string):
  | { code: string; entity: ReferenceEntity }   // prefix present
  | { code: string; entity: null }              // prefixless; caller resolves against both
  | null;                                       // not a valid code
```

`normalizeReferenceCode` is shared with search (`marketplace-search.md`), which uses it to decide
whether a `q` value is an exact-identifier lookup rather than a text query, and which table to hit.

### API surface

- Submission and task responses each gain `referenceCode: string`.
- `references.resolve({ code })` resolves a code to `{ entity, taskId, submissionId? }` under the
  caller's existing visibility permissions, or a not-found error carrying a machine-readable reason
  per ADR-0058. An ambiguous prefixless code returns a distinct reason listing both candidates.
- Existing reads by id are unchanged. A code is an additional address, not a replacement.

## Security & Privacy considerations

- **A code is an identifier, not a capability.** Eight random characters are guessable in a way a
  36-character digest is not. Every read through a code applies exactly the same visibility rules as a
  read through the id — ADR-0014's unlisted-task rule, ADR-0016's submission-visibility axis,
  ADR-0021's reveal rules, and ADR-0030's private-task access. Nothing may come to rely on a code
  being unguessable.
- **Not-found and not-permitted are indistinguishable.** The resolver returns the same response for a
  code that does not exist and one the viewer may not see, so it cannot be used to enumerate hidden
  work. Ambiguity reporting must not leak this either: a prefixless code matching one visible and one
  hidden row resolves to the visible one and reports no ambiguity.
- **The resolver is a public unauthenticated route** and therefore an enumeration surface. It is rate
  limited through the shared module (ADR-0038) rather than with bespoke logic.
- **Codes are minted from a CSPRNG**, not from a counter or a timestamp, so a code leaks neither
  volume nor ordering.

## Testing & Verification

1. **Format.** Every minted code matches `^(SUB|TSK)-[0-9A-HJKMNP-TV-Z]{8}$`. No code contains `I`,
   `L`, `O` or `U`.
2. **Uniqueness.** Minting 100,000 codes per entity produces no duplicates, and a forced collision
   (seeded generator returning a taken code) retries and succeeds rather than throwing.
3. **Idempotent submission.** Replaying a submission with the same idempotency key returns the
   original row with its original code, and mints no second code.
4. **Single-owner task minting.** A task whose row is written by the intent completion, and the same
   task arriving again through a reconciliation pass over the same `TaskCreated` event, end with
   exactly one row and one code. The reverse order does too.
5. **Normalization.** `sub-7k2qa9xf`, `7K2QA9XF`, ` SUB-7K2QA9XF `, and `SUB-7K2QA9XF` with `O`
   substituted for `0` all resolve to the same submission. A nine-character input, an empty input, and
   one containing `U` all return `null` rather than throwing.
6. **Prefix routing and ambiguity.** A `TSK-` code never resolves to a submission. A prefixless code
   matching one row resolves; matching one row in each table reports ambiguity with both candidates;
   matching one visible and one hidden row resolves to the visible one and reports no ambiguity.
7. **Backfill idempotency.** The migration-idempotency integration test covers both columns and
   indexes. The backfill script run twice assigns codes on the first pass and changes zero rows on the
   second.
8. **Journal.** `migrations-journal.test.ts` passes: sequential `idx`, strictly increasing `when`,
   `.sql`-file and journal-entry parity.
9. **Resolver.** `/s/<code>` 308-redirects to the canonical deep link for each entity. A nonexistent
   code and a code for a row the caller may not see return byte-identical responses.
10. **Visibility.** A private task and its submissions are unresolvable by a non-permitted caller and
    resolvable by a permitted one, exercised for each role ADR-0042 grants evidence access to.
11. **UI.** The code renders with a working copy control on task detail, task lists, the gallery,
    worker submission history, and `/live`, verified in Storybook at both themes with a `play`
    assertion on the copy interaction.
12. **Round trip with search.** Pasting a displayed code of either kind into the search box returns
    exactly that row — the integration point with `marketplace-search.md`.

## Non-goals

- **Not adding codes to agents or task drops.** The scheme extends with a further prefix if a need
  appears; neither is something users currently ask to quote.
- **Not replacing `submissions.id` or `tasks.id`.** The primary keys and the idempotency key are
  unchanged, and task URLs keep `taskId` in the path.
- **Not a vanity or user-chosen code.** Codes are minted, not requested.
- **Not a permalink guarantee for deliverable content.** A code identifies the record; artifact
  storage and content addressing are separate concerns.
- **Not a QR or short-link service.** `/s/<code>` resolves a code; it is not a general URL shortener.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- ADR: ADR-0098
- Two-deploy migration precedent: ADR-0008
- Task-row write paths that must mint exactly one code: ADR-0055, ADR-0029
- Visibility rules resolution must apply: ADR-0014, ADR-0016, ADR-0021, ADR-0030, ADR-0042
- Error-reason requirement: ADR-0058 · Rate limiting: ADR-0038
- Current identifier derivation: `apps/backend/src/services/relayed-intents.ts`
- Migration and journal rules: `AGENTS.md`, `docs/DB_GUIDE.md`
