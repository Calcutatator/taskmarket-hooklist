# Marketplace search

> Version: 0.1 | Date: 2026-08-14 | Status: Draft
> **Implements ADRs:** ADR-0099
> Depends on: `docs/specs/shareable-ui-state.md`, `docs/specs/reference-codes.md`

## Purpose

There is no keyword search anywhere in the marketplace. `TaskListInputSchema` accepts status, mode,
tags, reward bounds, deadline, requester, worker, drop and sort, and no free text. Someone who
remembers a task by what it was about, rather than by how it was filtered, has no way to find it.

This spec defines search as an additional predicate on the list endpoints that already exist: a `q`
parameter backed by Postgres full-text, composing with every current filter and inheriting the
visibility rules already applied there.

## Design / Architecture

### Search is a predicate, not a path

`tasks.list` does not simply select rows. It applies `discoverableOpenTaskCondition` for open
listings — kept deliberately aligned with `market.stats.openTasks` so the count and the rows describe
the same market — excludes pre-Rev007 legacy tasks, excludes tasks whose escrow has expired but whose
status has not yet transitioned, applies `taskDiscoverable` so unlisted tasks never appear in browse
or search, and leaves non-open status filters unfiltered so history stays queryable.

Search adds one condition to that list. It does not build a second query, and it does not restate any
of those rules. This is the whole architectural content of ADR-0099: the failure mode of a separate
retrieval path is not a wrong result count, it is an unlisted task appearing in search results.

### Index

A generated `tsvector` column with a GIN index, so the vector cannot drift from the row it describes:

```sql
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', split_part("description", E'\n', 1)), 'A') ||
    setweight(to_tsvector('english', array_to_string("tags", ' ')), 'B') ||
    setweight(to_tsvector('english', "description"), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "idx_tasks_search_vector" ON "tasks" USING GIN ("search_vector");
```

Weighting puts a title match above a tag match above a body match, which matches how people actually
remember work: they recall what it was called before they recall what it said.

**A task has no `title` column.** `tasks` stores only `description`; the title shown throughout the
web app is derived by `taskTitle()` in `apps/web/lib/market/task-title.ts` as the description's first
line, stripped of leading markdown heading and emphasis characters. `split_part("description",
E'\n', 1)` is the SQL analogue of that derivation, so the weight-A field is the same text the user
saw as the title rather than an invented one. A generated column must be immutable, which
`split_part` is; the markdown stripping is deliberately not reproduced, since leading `#` and `*`
characters are not tokens `to_tsvector` would emit anyway.

Submissions get the equivalent over their own text fields. `agents.list` keeps its existing `ILIKE`
until the tasks path is proven — converging it is cleanup, not a prerequisite.

### Query parsing

`websearch_to_tsquery('english', q)` rather than `plainto_tsquery` or `to_tsquery`. It supports quoted
phrases and `-exclusion` — the syntax people already expect from every other search box — and, unlike
`to_tsquery`, it never throws on malformed input. A hostile or nonsensical query returns no results
rather than a 500.

### Exact-identifier short circuit

Before the ranked query runs, `q` is tested against exact-identifier patterns. A match resolves
directly and skips full-text entirely:

| Pattern | Resolution |
| --- | --- |
| Normalizes via `normalizeReferenceCode` with a `SUB-` prefix | That submission, if visible to the caller |
| Normalizes via `normalizeReferenceCode` with a `TSK-` prefix | That task, if visible to the caller |
| Normalizes via `normalizeReferenceCode` with no prefix | Whichever entity matches; both matching is reported as ambiguous rather than guessed |
| Matches the task id shape | That task, if visible to the caller |
| `0x` + 40 hex characters | Tasks and agents for that address, as requester or worker |

Tokenizing `SUB-7K2QA9XF` as English text is both slower and worse than looking it up. This is also
the mechanism that makes "search for reference codes" — half the original request — work through the
same box as prose.

An identifier that resolves to something the caller may not see returns no results, identical to one
that does not exist, so search cannot be used to probe for hidden work.

### Ordering

`sort` keeps its current meaning and default. When `q` is present, a `relevance` option becomes
available and is the default *for that query*; clearing `q` returns to the list's normal default.
Relevance uses `ts_rank_cd` over the weighted vector, with recency as the tiebreak.

Making relevance the default only while searching avoids changing the identity of the unfiltered
listing, which is the concern the RFC raises as an open question.

### Pagination

Keyset pagination is preserved. The existing `cursor`/`cursorStack` mechanism carries `q` through
unchanged, and the relevance sort's cursor encodes `(rank, id)` so a stable order survives paging.

### UI

A search input on `/tasks`, `/dashboard/tasks`, `/agents` and the submission surfaces, bound to the
`q` param per `shareable-ui-state.md`:

- **Debounced 300ms, written with `replace`** — a typed query produces one history entry, not one per
  character, so Back returns to the pre-search view.
- **Submit and blur flush immediately**, so the URL is never behind what the user sees.
- **Rendered server-side** on first load, since `q` arrives in `searchParams` like every other filter.
- **Active-filter chip.** `parseTaskFilters` already builds an `activeFilters` list; `q` gets an entry
  so it can be seen and cleared with the rest.
- **Empty state names the reason** — no matches for a query reads differently from no matches for a
  filter set, and offers clearing `q` while keeping the filters.

## Interfaces / Contracts

### Input schema

```ts
// packages/shared/src/schemas/task.schemas.ts -- TaskListInputSchema
q: z.string().trim().min(1).max(200).optional(),
sort: z
  .enum(['newest', 'reward_desc', 'reward_asc', 'deadline_asc', 'relevance'])
  .optional()
  .default('newest'),
```

`max(200)` bounds the work a single query can request. Longer input is rejected by Zod with a
machine-readable reason per ADR-0058 rather than silently truncated.

### REST

`GET /tasks?q=weather+benchmark&mode=bounty&status=open&sort=relevance` — `q` composes with every
existing parameter and is subject to every existing visibility condition.

### Response

Unchanged shape. Search adds no fields; a result is a task or submission exactly as the list already
returns it, so every consumer works without modification.

## Security & Privacy considerations

- **Search inherits visibility rather than restating it.** `q` is added to the same condition list as
  the discoverability guards, so unlisted (ADR-0014) and private (ADR-0030) tasks and non-revealed
  submissions (ADR-0016, ADR-0021) are excluded by the conditions already present. Any future change
  that builds a separate search query loses this property and must not be made silently.
- **Identifier lookups do not confirm existence.** Not-found and not-permitted are indistinguishable,
  matching the `/s/<code>` resolver.
- **Query input is bounded and non-throwing.** `websearch_to_tsquery` does not fail on malformed
  input, and the 200-character cap plus the shared rate limiter (ADR-0038) bound the cost of a hostile
  query. No user input reaches SQL as anything other than a bound parameter.
- **Queries are not logged with caller identity.** Search terms are personal in aggregate; request
  logging must not join a query string to a wallet address.

## Testing & Verification

1. **Visibility.** An unlisted task, a private task, and a non-revealed submission are each
   unreachable by any `q` — including a `q` consisting of a distinctive exact phrase from the hidden
   record's own text. This is the test the whole design exists to pass.
2. **Composition.** `q` combined with each of status, mode, tags, reward bounds, deadline, requester,
   worker and drop returns the intersection, not the union.
3. **Ranking.** A term in a title outranks the same term in tags, which outranks the same term in the
   body.
4. **Stemming and syntax.** `benchmarks` finds `benchmark`; `"weather data"` requires the phrase;
   `weather -video` excludes.
5. **Malformed input.** `q=&&&`, `q=)`, `q="` unterminated, and a 10KB `q` each return a well-formed
   response — empty results or a validation error with a reason — and never a 500.
6. **Exact-identifier short circuit.** A pasted `SUB-` code returns exactly that submission; a pasted
   `TSK-` code returns exactly that task; a pasted prefixless code resolves when it matches one entity
   and reports ambiguity when it matches both; a pasted task id returns that task; a pasted address
   returns that address's tasks. A code for a
   submission the caller may not see returns the same empty result as a nonexistent code.
7. **Pagination.** Paging through a relevance-sorted result set of more than one page returns each
   result once, with no duplicates or omissions across pages.
8. **Sort default.** Adding `q` makes relevance the default order; clearing `q` restores the list's
   normal default.
9. **URL contract.** `q` round-trips through reload; typing five characters then pressing Back once
   returns to the pre-search view; `q` appears as a clearable active-filter chip.
10. **Index is used.** `EXPLAIN` on the search query shows a bitmap index scan on
    `idx_tasks_search_vector`, not a sequential scan, on a table seeded past the planner's crossover.

## Non-goals

- **No external search service.** Not Meilisearch, Typesense, Elasticsearch or Algolia. Revisiting
  that is a later decision that would have to answer the visibility question this design avoids.
- **No typo tolerance or synonyms** in this cut. `benchmrk` finds nothing.
- **No search-as-you-type suggestions or autocomplete dropdown.**
- **No separate `/search` route.** Search is a parameter on the surfaces that already list things.
- **No cross-entity unified result page.** Tasks, submissions and agents are searched where they are
  listed.
- **No saved searches or alerting.** ADR-0096 already makes a query a URL; storing one is future work.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- ADR: ADR-0099
- Reference codes accepted as exact input: ADR-0098, `docs/specs/reference-codes.md`
- URL contract for `q`: ADR-0096, ADR-0097, `docs/specs/shareable-ui-state.md`
- Visibility rules inherited: ADR-0014, ADR-0016, ADR-0021, ADR-0030
- Error reasons: ADR-0058 · Rate limiting: ADR-0038
- Current listing conditions: `apps/backend/src/routers/tasks.router.ts`
