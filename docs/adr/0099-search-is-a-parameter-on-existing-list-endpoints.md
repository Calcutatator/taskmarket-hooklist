# 0099 — Search is a parameter on the existing list endpoints, not a separate index

> **Decision (Y-statement):** In the context of a marketplace with no keyword search whose listings
> are already gated by non-trivial visibility rules, facing the risk that a second retrieval path
> would have to re-derive those rules and could leak what the listings hide, we decided to add a `q`
> parameter to the existing list endpoints backed by Postgres full-text search over a generated
> tsvector column, to achieve search that composes with every existing filter and inherits
> visibility for free, accepting Postgres-grade relevance rather than a dedicated search engine's.

- **Status:** Accepted
- **Date:** 2026-08-14
- **Accepted:** 2026-08-17
- **Embodiment:** Verified
- **Last audited:** 2026-08-17
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — reviewed at acceptance; no separate independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

`TaskListInputSchema` accepts status, phase, mode, auction type, requester actor type, tags, reward
bounds, deadline, requester, worker, task drop and sort. It accepts no free text. A person who
remembers a task by what it was about has no query that finds it. `agents.list` is the only endpoint
in the repo with a `search` input, implemented as an unindexed `ILIKE '%term%'` over `agentId` and a
prefix match on `address`.

What makes the retrieval-path question significant is not performance, it is visibility. `tasks.list`
does not simply select rows: it applies `discoverableOpenTaskCondition` for open listings, keeps that
condition aligned with `market.stats.openTasks` so the count and the rows describe the same market,
excludes pre-Rev007 legacy tasks and tasks whose escrow has expired but whose status has not yet
transitioned, applies `taskDiscoverable` so unlisted tasks never appear in browse or search
(ADR-0014), and leaves non-open status filters unfiltered so history stays queryable. Submissions
carry their own independent visibility axis with its own reveal rules (ADR-0016, ADR-0021), and
private tasks add allowlist and password access on top (ADR-0030).

That logic is subtle, it has been corrected several times, and it lives in one place. A second
retrieval path has to reproduce all of it, and stay correct as it changes. The failure mode is not a
wrong result count — it is a private or unlisted task appearing in a search result. An external index
makes this strictly worse, because the rules would have to be evaluated at index time against data
whose visibility changes afterwards.

The available implementations differ mainly in what they cost to keep correct. `ILIKE '%term%'`
cannot use a B-tree index and scans linearly, which is tolerable on the agents table and not on the
main browse surface. Postgres full-text over a generated `tsvector` with a GIN index handles stemming,
phrase queries and ranking, and — decisively — is just another `WHERE` clause, so it composes with
every condition above rather than replacing them.

Search also has to handle input that is not prose. Users will paste a reference code (ADR-0098), a
task id, or a wallet address into the same box. Tokenizing `SUB-7K2QA9XF` as text is both slower and
worse than looking it up directly.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| `q` parameter on existing list endpoints, Postgres full-text over a generated tsvector with a GIN index | Visibility rules apply unchanged because search is one more predicate; composes with every filter and the existing cursor pagination; no new infrastructure; stemming, phrases and exclusions come free | Relevance is Postgres-grade, not engine-grade; no typo tolerance or synonyms; ranking quality is bounded by what `ts_rank_cd` offers |
| A dedicated `/search` endpoint sharing the same visibility helpers (rejected) | Search-specific response shape; free to rank differently | A second path through the same rules that must be kept aligned by hand; loses filter composition unless every filter is reimplemented; the shared-helper discipline is exactly what erodes under time pressure |
| External search service — Meilisearch, Typesense, Algolia (rejected) | Best relevance, typo tolerance, instant faceting | Visibility must be re-derived at index time against data whose visibility changes later, so the leak is structural rather than a bug; new infrastructure, new failure mode, new cost; index lag makes search disagree with the listing it sits next to |
| `ILIKE '%term%'` over description and title (rejected) | Smallest possible change; matches what `agents.list` already does | Cannot use an index, so it degrades linearly on the busiest surface; no stemming, so "benchmarks" misses "benchmark"; no ranking |
| `pg_trgm` similarity search (rejected as the primary mechanism) | Typo tolerance; good on short identifier-like fields | Poor fit for paragraph-length descriptions; larger indexes; ranking by trigram similarity is not what a prose query wants. Retained as an option for identifier fields specifically |

## Decision

Keyword search is a `q` parameter on the existing list endpoints — `tasks.list` first, then
`submissions` and `agents.list` — implemented as Postgres full-text search over a generated
`tsvector` column with a GIN index, queried through `websearch_to_tsquery` so quoted phrases and
`-exclusion` behave as users already expect.

Search is a predicate, not a path: it is added to the same condition list as every other filter, and
it inherits the visibility rules already applied there without restating them.

Before running the ranked query, `q` is checked against exact-identifier patterns — reference code,
task id, wallet address. A match resolves directly and short-circuits the full-text query.

## Consequences

**Positive:**

- Search cannot surface what browse hides, because it is the same query with one more condition. This
  is the property that motivated the decision.
- Search composes with every existing filter and with the existing cursor pagination, so "open bounty
  tasks about weather data over 50 USDC" is expressible without new machinery.
- No new infrastructure, no index-lag skew between search results and the listing beside them, and
  nothing new that can be down while the site is up.
- Pasting a reference code, task id or address into the search box does the obvious thing.
- `websearch_to_tsquery` never throws on malformed input, so a hostile or nonsensical query returns
  no results rather than an error.

**Negative / trade-offs:**

- No typo tolerance and no synonyms. "benchmrk" finds nothing, and users will notice.
- Relevance is `ts_rank_cd`, which is adequate rather than good. Tuning it is limited compared to a
  dedicated engine.
- A generated `tsvector` column plus GIN index adds write cost and storage on the tasks table, on
  every insert and description update.
- Language configuration is fixed at the column level, so multi-language descriptions are stemmed
  with the wrong rules.

**Neutral / follow-up:**

- If Postgres full-text proves insufficient, moving to an external engine is a later decision with its
  own record — and it would then have to answer the visibility question this ADR avoids by
  construction.
- `agents.list`'s existing `ILIKE` search stays as-is until the tasks path is proven; converging it is
  cleanup, not a prerequisite.
- Whether ranked relevance or recency is the default order is left open in the RFC, since it changes
  the identity of the default listing.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- Spec: `docs/specs/marketplace-search.md`
- Reference codes accepted as exact-match input: ADR-0098
- Visibility rules search must inherit: ADR-0014, ADR-0016, ADR-0021, ADR-0030
- Current listing conditions: `apps/backend/src/routers/tasks.router.ts`
