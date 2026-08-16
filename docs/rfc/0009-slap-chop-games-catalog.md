# 0009 — Slap-Chop Games catalog

- **Status:** Discussion
- **Date:** 2026-08-16
- **Author:** Codex, synthesizing the product scope approved by Oscar Mander-Jones
- **Supersedes / Superseded-by:** —

## Summary

Taskmarket should add Slap-Chop Games as a separate deployable web application: a minimal,
full-bleed catalog of square game covers that opens curated Taskmarket HTML artifacts as
fullscreen games. The public product has only catalog browsing, search, play, back navigation,
and upvote/downvote curation. A private curator workspace pins each published game to an exact
Taskmarket submission and artifact, while a shared sandbox module keeps the existing untrusted-HTML
security policy consistent across Taskmarket and Slap-Chop.

## Motivation

Taskmarket already accepts interactive HTML artifacts and can render them inside a restricted
iframe. Those games currently remain attached to individual tasks and submission-review flows;
there is no consumer product for discovering and replaying the best results. A task marketplace is
the right provenance and production layer, but it is not the right browsing experience for someone
who only wants to find and play a game.

The opportunity is to make the output of Taskmarket legible as its own catalog without copying or
re-uploading the work. Slap-Chop should preserve a verifiable path back to the task, accepted worker,
submission, artifact hashes, and stored HTML while presenting almost none of the marketplace chrome.

The proposal also needs an explicit curation seam. A task may have several submissions and each
submission may have several artifacts. Pointing a catalog entry at only a task ID would let artifact
selection change implicitly as later submissions arrive or selection rules evolve. A curator must
therefore resolve a task and deliberately pin the exact playable artifact that was reviewed.

## Proposal

### Product shape

Create a new Next.js application at `apps/slap-chop-games`, published independently from
`apps/web` and backed by the existing Taskmarket backend and PostgreSQL database. Its public routes
are:

- `/` for the catalog and search;
- `/games/[slug]` for fullscreen play; and
- no public authoring, marketplace, profile, comments, or administration routes.

The catalog begins below a single 44-pixel rail containing the Slap-Chop Games wordmark and search.
Everything below that rail is an edge-to-edge grid with no maximum content width. Covers remain
square at every breakpoint: two columns on phones, four on tablets, six on ordinary desktop
viewports, and eight on wide viewports. A one-pixel gap exposes the grid structure without adding
card chrome.

Every tile has a restrained caption containing the game title and net vote score. Pointer hover and
keyboard focus may reveal creator context, but the title cannot depend on hover because touch and
keyboard users need the same catalog information. Search matches title, tags, creator, and curated
task metadata. Matching games retain their popularity order.

Selecting a tile navigates to a real route rather than opening a modal. The game fills `100dvh`,
with a translucent overlay for Back, title, score, upvote, and downvote. Browser Back returns to the
same query and scroll position; direct visits fall back to `/`. The controls remain available in
loading, expired-link, oversized-artifact, and runtime-error states.

The visual shell is deliberately neutral. Near-black and warm off-white provide the application
surfaces; game covers provide almost all visible color. Instrument Sans supplies compact UI labels,
the spacing scale starts at four pixels, and motion is limited to short opacity and focus
transitions that honor reduced-motion preferences.

### Catalog curation

Provide an unlisted `/curate` workspace in the Slap-Chop application for allowlisted curators. A
curator:

1. pastes a Taskmarket task URL or ID;
2. sees eligible accepted submissions, HTML artifacts, provenance, and hashes;
3. selects one exact playable artifact;
4. previews it through the production game sandbox;
5. supplies title, slug, tags, and a square cover image; and
6. saves a draft, publishes it, or hides an existing entry.

A publish operation records the task ID, submission ID, HTML artifact ID, artifact hashes, and cover
reference. Publication refuses a task or submission that the public catalog could not legally and
technically read. The initial eligibility rules are:

- the task is public and resolved;
- the selected submission is accepted and not rejected;
- the selected artifact is HTML, has a playable role, and is no larger than the interactive
  runtime limit;
- the curator has successfully loaded and reviewed the artifact in the same sandbox policy users
  will receive; and
- a square cover is present, either as an eligible Taskmarket image artifact or as a curator-owned
  catalog asset.

Hiding is immediate and reversible. Curation actions write an audit record containing the curator,
action, affected game, and before/after metadata. Curators do not edit or replace the underlying
Taskmarket artifact.

### Voting and ranking

Browsing and playing remain anonymous. Voting uses the existing Privy identity integration and
does not require the user to create or connect a wallet. The first vote opens the lightweight sign-in
flow. Each Privy user has at most one vote per game, with values `1` or `-1`; selecting the active
vote removes it, and selecting the opposite vote changes it atomically.

The default catalog ordering uses a longer-lived adaptation of Reddit's archived Hot score:

```text
net = upvotes - downvotes
magnitude = log10(max(abs(net), 1))
hot = sign(net) * magnitude + (publishedAt - fixedEpoch) / 604800
```

The seven-day divisor replaces Reddit's 45,000-second constant because a game catalog should turn
over in days and weeks rather than hours. Ten net votes therefore offset roughly one week of age.
Games with equal score use net votes, publication time, then stable game ID as deterministic
tie-breakers. A zero-vote catalog orders newest first.

Downvotes affect ordering but never unpublish a game automatically. Curators retain responsibility
for safety and catalog eligibility. Play counts do not affect the first release's ordering because
unauthenticated starts are easier to manipulate and would add tracking policy without being needed
for the social-curation goal. The grid does not reorder beneath a user during an active catalog
session; new ranking takes effect on navigation, search, or refresh.

Put the formula and deterministic tie behavior behind one Ranking module interface with fixed test
vectors. Callers receive ordered catalog entries and a display score; they do not reproduce ranking
logic in the browser.

### Game runtime and security

The existing Taskmarket interactive preview already caps HTML at 5 MB, fetches it as text, injects a
Content Security Policy, and renders it through a `srcDoc` iframe with only `allow-scripts`. It
blocks forms, connections, nested frames, workers, objects, popups, storage-origin privileges, and
top navigation.

Extract the pure policy and document-building implementation from
`apps/web/lib/sandboxed-html.ts` into a shared module such as `packages/html-sandbox`. Both
applications use thin visual adapters around that single module. The shared Game Runtime interface
is responsible for:

- identifying eligible HTML artifacts;
- enforcing declared and fetched byte limits;
- fetching and refreshing signed artifact URLs;
- verifying the fetched bytes against the pinned artifact hash before execution;
- injecting the shared CSP and constrained parent-message bridge; and
- returning typed loading, size, integrity, fetch, and runtime outcomes.

The first release does not grant same-origin, forms, popups, navigation, pointer lock, workers,
network connections, wallet access, or additional browser capabilities. A game that requires a
blocked capability is ineligible until a later proposal changes the shared policy deliberately.

### Backend interface and data

Add a public `games` router and a curator-only `gameCuration` router to the existing backend. Their
external interfaces are:

- `games.list` with query and cursor inputs;
- `games.get` by slug;
- `games.vote` with game ID and vote value;
- `gameCuration.resolveTask` for eligible submissions and artifacts;
- `gameCuration.upsert` for draft metadata and pinned source;
- `gameCuration.publish`; and
- `gameCuration.hide`.

The public application receives catalog-specific response objects, not raw database rows or storage
credentials. List and detail responses include short-lived cover/game preview URLs only when needed.
The catalog page remains a Server Component by default; search and voting are the smallest client
leaves that require interaction or authentication.

The initial database model contains:

- `games` for slug, display metadata, publication status, pinned source IDs and hashes, cover,
  cached vote totals, and timestamps;
- `game_votes` for game, Privy user ID, vote value, and timestamps, unique on `(game, user)`; and
- `game_curation_events` for the audit history.

Vote changes update the canonical vote row and cached counters in one transaction. Counters can be
recomputed from `game_votes`; they are an ordering optimization rather than a second source of
truth.

Curator writes require a verified Privy access token whose user ID is present in a server-side
allowlist. Public vote writes also require a verified Privy token and per-user/IP rate limiting, but
not a wallet signature or payment.

### Repository and delivery integration

The new application participates in the root workspace, Turbo pipeline, Makefile targets, CI, and
preview/production deployment workflows. Its package name is `@taskmarket/slap-chop-games`.

Delivery is split into six reviewable phases:

1. application scaffold, Makefile/CI integration, backend schema, and shared sandbox module;
2. curator task resolution, artifact eligibility, preview, publication, hiding, and audit history;
3. responsive catalog, deterministic search, and loading/empty/error surfaces;
4. fullscreen route, integrity verification, Back behavior, and scroll/query restoration;
5. Privy voting, optimistic controls, ranking, uniqueness, and rate limiting; and
6. production deployment, accessibility verification, and end-to-end catalog-to-game-to-catalog
   coverage.

Implementation must include unit tests for ranking vectors and monotonic vote behavior, integration
tests for vote replacement/removal and curator eligibility, browser tests for search/navigation
restoration, and sandbox tests proving prohibited capabilities remain blocked.

### Recorded implementation decisions

The product and architecture recommendations were explicitly approved on 2026-08-16 and recorded
in ADR-0087 through ADR-0090. The RFC remains in Discussion until its accepted decisions are
embodied; implementation may now proceed against those ADRs.

## Resolved decisions

1. **Domain and deployment:** production uses `games.taskmarket.dev` and a dedicated
   `@taskmarket/slap-chop-games` Railway service in the existing Taskmarket project. Existing
   Taskmarket release/platform owners own preview, devnet, production and rollback.
2. **Cover storage:** eligible Taskmarket image artifacts remain source-pinned. Curator-supplied
   covers use immutable `slap-chop-games/covers/sha256/<digest>.<ext>` keys through the existing
   storage backend, with catalog-specific provenance and retention.
3. **Curator bootstrap:** the backend verifies Privy access tokens and authorizes exact user IDs
   from the fail-closed `SLAP_CHOP_CURATOR_PRIVY_USER_IDS` environment allowlist. Membership and
   recovery require an authorized Railway configuration update and redeploy.
4. **Legal treatment:** only `games.vote` receives an explicit exemption from versioned
   marketplace legal acceptance. It still requires verified Privy identity and per-user/trusted-IP
   rate limits; browsing and playing remain anonymous. Other writes remain default-gated.
5. **Ranking:** launch uses the seven-day (`604800` second) Hot-score divisor, a fixed
   `2026-01-01T00:00:00Z` epoch and deterministic ties. `SLAP_CHOP_RANKING_MODE=new` is the
   operational rollback; formula changes require product-owner approval and backend vector updates.

## Non-goals

- Comments, text reviews, profiles, follows, favorites, collections, or social feeds.
- Personalized recommendations, category navigation, or user-selectable sorting in the first
  release.
- Public game submission or a replacement for Taskmarket task and submission workflows.
- Copying, editing, or re-hosting a game's HTML outside the existing artifact provenance model.
- Automatic cover screenshot generation in the first release.
- Play-count ranking, behavioral analytics, advertising, or cross-site tracking.
- Multiplayer, achievements, global leaderboards, cloud saves, or cross-session game state.
- Native browser fullscreen, pointer lock, wallet access, network access, or broader iframe
  permissions.
- Comments or vote state being written on chain.
- Changes to task, submission, acceptance, settlement, or smart-contract behavior.

## References

- [Wayfinder implementation map](https://github.com/daydreamsai/taskmarket/issues/553)
- [ADR-0087 — Separate app over immutable Taskmarket artifacts](../adr/0087-slap-chop-is-a-separate-app-over-immutable-taskmarket-artifacts.md)
- [ADR-0088 — Fail-closed curation and catalog-owned covers](../adr/0088-slap-chop-curation-is-fail-closed-and-covers-use-catalog-owned-keys.md)
- [ADR-0089 — Privy voting without marketplace legal assent](../adr/0089-slap-chop-votes-use-privy-without-marketplace-legal-assent.md)
- [ADR-0090 — Seven-day Hot ranking](../adr/0090-slap-chop-ranking-uses-a-seven-day-hot-score.md)
- [Frontend development guide](../FRONTEND_GUIDE.md)
- [Backend development guide](../BACKEND_GUIDE.md)
- [Database guide](../DB_GUIDE.md)
- [RFC-lite process decision](../adr/0032-adopt-rfc-lite-for-proposals.md)
- [Existing sandbox policy](../../apps/web/lib/sandboxed-html.ts)
- [Existing interactive HTML renderer](../../apps/web/components/market/interactive-html-preview.tsx)
- [Submission and artifact schemas](../../packages/shared/src/schemas/submission.schemas.ts)
- [Reddit archived ranking implementation](https://github.com/reddit-archive/reddit/blob/master/r2/r2/lib/db/_sorts.pyx)
- [WHATWG iframe sandbox specification](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)
- [Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
