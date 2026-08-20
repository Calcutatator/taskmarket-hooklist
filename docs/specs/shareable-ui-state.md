# Shareable UI state and deep linking

> Version: 0.1 | Date: 2026-08-14 | Status: Draft
> **Implements ADRs:** ADR-0096, ADR-0097
> Feeds into: `docs/specs/marketplace-search.md`, `docs/specs/reference-codes.md`, `docs/specs/bookmarks.md`

## Purpose

Every screen in `apps/web` should have an address. Today most do not: a person three filters deep into
a task list, or looking at a specific artifact in a submission gallery, has nothing to send anyone and
no way back.

This spec defines the contract that makes shareable UI state URL-backed across the app — the state
classification, the param registry, the read and write helpers, history semantics, and the
surface-by-surface migration. It is the foundation the other three specs in this set assume: a search
query is a shareable param, a reference code appears in a deep link, and a bookmark stores one.

## Design / Architecture

### The three tiers

Every piece of UI state belongs to exactly one tier. The classification is not advisory: an
unclassified piece of interactive state is an incomplete change, and shareable-tier state that is not
URL-backed is a blocking review finding.

**Shareable — lives in the URL query string.** The test: would a second person opening this link need
this value in order to see what I see? Filters, sort, view mode, pagination cursor, active tab or
section, which entity is selected within a page, whether an overlay is open and on what, search query,
and any expand/collapse that reveals content rather than chrome.

**Session — lives in `sessionStorage` or `localStorage`.** Personal to this browser, and sharing it
would either leak something or mean nothing. Draft form and wizard values, dismissed banners, sidebar
collapse, theme preference, "don't show this again" acknowledgements.

**Ephemeral — lives in React state.** Changes faster than a person can act on it, or is derived from
something else. Hover and focus, animation frames, video scrub position, in-flight request state,
toasts, transient validation display.

Two cases sit near the boundary and are resolved explicitly:

- **A dialog's open state is shareable; its internal scroll position is ephemeral.** Opening a preview
  is a place a person can be sent to. Where they have scrolled inside it is not.
- **A form's draft values are session, but its "which step" is shareable.** A wizard step is a place;
  the half-typed description in it is not, and putting it in the URL would push unpublished work into
  browser history, referrer headers and any screen-share.

### No mirror

A URL-backed value has exactly one storage location. This is the rule that fixes the current bug, and
it is worth stating separately from the tier table because the tier table alone does not imply it.

```tsx
// Wrong -- the current pattern. The URL seeds state and is then stale forever.
const [artifactId, setArtifactId] = useState(initialArtifactId);

// Right -- the URL is read on every render and written on every change.
const [artifactId, setArtifactId] = useUrlState('artifact');
```

`SubmissionGalleryDialogInner` is the live example: it seeds `selectedArtifactId` from
`initialArtifactId` and never writes back, so arrowing through the carousel leaves the address bar
describing a different artifact than the one on screen.

### The param registry

One module, `apps/web/lib/url-state/registry.ts`, declares every shareable param. A param not in the
registry may not be written; `useUrlState` rejects an unregistered key at the type level.

Each entry records the param name, which routes own it, its legal values and its default. A param name
claimed by two features on overlapping routes is a build-time conflict in one file, rather than a
silent state clobber discovered in production.

Global params keep one meaning everywhere they appear:

| Param | Meaning |
| --- | --- |
| `q` | Free-text search query |
| `sort` | Sort order for the primary list on the route |
| `view` | Presentation of the primary list (`table`, `gallery`, ...) |
| `cursor`, `cursorStack` | Forward cursor and back-stack for keyset pagination |
| `section`, `tab` | Active top-level section, and active tab within it |
| `submission` | Selected submission, addressed by reference code |
| `artifact` | Selected artifact within a submission |
| `panel` | Open overlay or side panel, by name |

Where a route genuinely has two of the same control, the second takes a qualified name — `view` and
`historyView` — chosen in the registry rather than derived from a prefix scheme.

### URL rules

Four rules, from ADR-0097. The first, second and fourth already hold on `/tasks`; the third is new
everywhere.

1. **Defaults are omitted.** `taskFiltersHref` already skips any param equal to its default, so
   `/tasks` and `/tasks?status=ALL&sort=newest` are not two addresses for one screen. Generalized to
   every param.
2. **Invalid values fall back.** `parseStatus` validates against the real `TaskStatus` enum and falls
   back to `ALL` rather than forwarding a crafted value to the API. Every param gets a parser with the
   same posture: never throw, never 404, never forward unvalidated.
3. **Unowned params are preserved.** Rewriting the query string carries through every param the
   surface does not own, so campaign and referral tags survive a filter change. Nothing does this
   today, so it needs its own coverage rather than being assumed.
4. **Absent means default.** No surface distinguishes an absent param from one explicitly set to its
   default.

### History semantics

Every write declares its intent. Wrong in either direction is why URL state gets abandoned:
push-per-keystroke makes Back unusable, and replace-on-overlay-open makes Back leave the page.

| Intent | Method | Applies to |
| --- | --- | --- |
| **Refine** | `router.replace` | Typing in search, dragging a reward slider, toggling a filter chip, changing sort or view, arrowing within an open gallery |
| **Navigate** | `router.push` | Opening an overlay or panel, changing page or cursor, switching a top-level tab or section, selecting a different submission from a list |

Closing an overlay **replaces** the current entry with the closed address. It never pops.

Popping was built first and is wrong for a reason worth recording, because it looks like the tidier
option: `router.back()` lands on whatever the previous entry happened to be, and where overlays nest
— a submission gallery opened from inside a worker's history, say — that previous entry is another
*open* overlay, so Close reopens something instead of closing anything.
`e2e/grouped-submission-review.spec.ts` caught exactly that. Replacing cannot do it. Back from an
open overlay still reaches the page as it was before opening, because opening pushed; Back after
Close reaches the same place, because Close rewrote that pushed entry rather than adding to it. It
also removes the arrived-on-a-deep-link edge case that ownership tracking existed to handle.

Continuous inputs debounce before writing. A search box writes at most once per 300ms of quiet and
always on submit or blur, so a typed query produces one history-neutral replace rather than one per
character.

### Read and write

Server Components keep reading the `searchParams` prop directly — that path already works and is why
public reads render on the server. The helper exists for interactive leaves.

```
apps/web/lib/url-state/
  registry.ts     Param declarations: name, owning routes, legal values, default
  parse.ts        Per-param parsers with the fall-back-never-throw posture
  href.ts         Canonical URL construction: omit defaults, preserve unowned params
  use-url-state.ts  Client hook: read from useSearchParams, write via router
```

`parseTaskFilters` and `taskFiltersHref` are the working reference for `parse.ts` and `href.ts`. They
are generalized into these modules rather than rewritten, and `/tasks` is re-pointed at the shared
implementation as the first migration — which also serves as the proof that the generalization did not
change behavior.

### Migration

The contract lands with the helpers plus the highest-traffic surfaces, and the remaining routes follow.
The rule is in force from the first commit; surfaces are brought into compliance in order.

| Phase | Surfaces | Shareable state to move | Status |
| --- | --- | --- | --- |
| 1 | `lib/url-state/*`, `/tasks`, `/dashboard/tasks` | Re-point existing filters at the shared helpers; add `q` | Done |
| 2 | Task detail (`/tasks/[taskId]`, dashboard equivalent) | Gallery open state and selected artifact, round-tripped | Done |
| 3 | Worker submission history | `historyView`, `historySort`, `historyPage`, and its own gallery | Done |
| 3b | `/live` review panel | `reviewSort`, `reviewView`, `page`, `rejectedPage`, `selectedWorkerKey`, `selectedAwardWorkerKey` | Not started |
| 4 | `/agents`, `/humans`, `/leaderboard`, `/drops`, `/dashboard/inbox` | Sort, view, filters, selected entity, active inbox view | Not started |
| 5 | Remaining routes | Audit and classify; most will have nothing in the shareable tier | Not started |

Phase 2 is where the user-visible payoff starts: it is the first point at which a copied URL describes
what is actually on screen.

The contract is in force from phase 1 regardless of how far the migration has run: a *new* or
*materially changed* surface holding shareable state outside the URL is a blocking review finding
today. The unfinished phases are pre-existing surfaces not yet brought into compliance, not an
exemption from the rule.

## Interfaces / Contracts

### Registry entry

```ts
type UrlParam<T> = {
  name: string;              // camelCase, e.g. 'taskDropId'
  routes: string[];          // owning route patterns; overlap on a name is a build error
  parse: (raw: string | undefined) => T;   // never throws; returns the default on invalid input
  serialize: (value: T) => string | undefined;  // undefined means "omit" (rule 1)
  default: T;
};
```

### Client hook

```ts
function useUrlState<K extends RegisteredParam>(
  name: K,
  options?: { history?: 'refine' | 'navigate'; debounceMs?: number }
): [ParamValue<K>, (next: ParamValue<K>) => void];
```

`history` defaults to `'refine'`, because refinement is the common case and the failure mode of a
wrongly-pushed entry is more annoying than a wrongly-replaced one.

### Canonical href construction

```ts
function urlStateHref(
  basePath: string,
  current: URLSearchParams,     // carries unowned params through (rule 3)
  overrides: Partial<Record<RegisteredParam, unknown>>
): string;
```

### Overlay helper

```ts
function useOverlayParam(
  name: 'panel' | 'artifact' | 'submission'
): { value: string | undefined; open: (v: string) => void; close: () => void };
```

`close()` pops the history entry when this session pushed it, and otherwise replaces with the param
removed.

## Security & Privacy considerations

- **Draft content never enters the URL.** Form and wizard values are session-tier. A URL is written to
  browser history, sent in referrer headers on outbound links, recorded in server access logs, and
  visible in any screen-share; unpublished task descriptions must not travel that way.
- **Params stay untrusted.** Rule 2 is a security property, not a convenience: every param is
  validated against its real domain before reaching an API call, extending what `parseStatus` already
  does with an explicit note that a stale bookmark, crafted URL or crawler can put anything there.
- **A deep link is an address, not an authorization.** A URL naming a private task or a hidden
  submission grants nothing: the existing gates (ADR-0014, ADR-0016, ADR-0030, and the client-side
  private-task gate in ADR-0031) still decide what renders. Nothing in this spec may become the thing
  that authorizes a read.
- **Rule 3 preserves unowned params, which includes hostile ones.** They are carried through the query
  string and never interpreted, so preservation must not extend to reflecting an unowned param's value
  into the DOM.

## Testing & Verification

Acceptance criteria, each independently checkable:

1. **Round trip.** On task detail, opening the gallery at artifact A, arrowing to artifact C, and
   copying the URL yields a link that opens at artifact C. This is the specific bug the contract
   exists to eliminate; it is the first test to write.
2. **Reload fidelity.** For each migrated surface, setting every shareable control to a non-default
   value and hard-reloading restores the identical screen.
3. **Canonicality.** A surface at all-defaults has a bare path with no query string. Setting a control
   to its default value removes the param rather than writing it.
4. **Hostile input.** `?status=<script>`, `?sort=nonsense`, `?cursor=`, and a 10KB param value each
   render the default view with a 200 status and produce no API error.
5. **Unowned params survive.** Loading `/tasks?utm_source=x`, changing a filter, and reading the URL
   still shows `utm_source=x`.
6. **History intent.** Typing a five-character search query then pressing Back once returns to the
   pre-search view, not to four characters. Opening an overlay then pressing Back closes it and stays
   on the page.
7. **Direct-deep-link close.** Landing directly on a URL with an overlay param open and closing the
   overlay stays on the page rather than navigating to the previous site.
8. **No mirror.** A lint rule or a review checklist item fails a component that both reads a
   registered param and holds it in `useState`.
9. **Registry collision.** Declaring the same param name for two overlapping routes fails
   `make type-check web`.
10. **Server rendering.** Every migrated public surface still renders its state server-side; the
    production build shows no hydration mismatch on a deep link with every param set.

Coverage lives in `apps/web/lib/url-state/*.test.ts` for the parsers and href construction, Storybook
`play` assertions for the interactive round trip per component, and Playwright for reload, history and
hydration. Per `docs/FRONTEND_GUIDE.md`, changed stories need their accessibility check at `error`,
and the whole set must pass `make ui-ci`.

## Non-goals

- Not a redesign of any surface. This is addressability of what already renders.
- Not putting session or ephemeral state in the URL. See the tier table and ADR-0096's rejected option.
- Not a saved-view or saved-search feature. A filter set becomes a URL; storing one is `bookmarks.md`.
- Not changing what is visible to whom.
- Not a route-structure change. Deep links are query params on existing routes, except the `/s/<code>`
  resolver defined in `reference-codes.md`.
- Not a state-management library adoption.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- ADRs: ADR-0096 (where shareable state lives), ADR-0097 (param namespace and URL rules)
- Visibility gates a deep link must not bypass: ADR-0014, ADR-0016, ADR-0030, ADR-0031
- Reference implementation being generalized: `apps/web/lib/market/task-filters.ts`
- Round-trip bug: `apps/web/components/market/submission-gallery.tsx`
- Frontend requirements this must satisfy: `docs/FRONTEND_GUIDE.md`
