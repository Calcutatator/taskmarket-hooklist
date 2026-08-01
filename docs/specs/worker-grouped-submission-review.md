# Worker-grouped submission review

> Version: 1.1 | Date: 2026-07-31 | Status: Ready

## Purpose

The submission review queue currently treats every submission row as a separate review item. A
single worker can therefore occupy every visible card, every pagination slot, and every artifact
gallery position by submitting repeatedly. In the observed incident, one worker created 108
submissions. At the current page size of 10, that worker alone fills 11 review pages.

This spec changes the requester-facing review unit from a submission to a submitter. The outer
queue shows one representative card per worker address. A requester can drill into that submitter
and inspect every submission in the same gallery/list experience used by the outer queue. This
reduces attention and DOM flooding without classifying repeated work as spam or hiding legitimate
revisions.

**Version 1.1** adds Milestone 5: `benchmark` tasks have a second, optional submissions channel
(alongside their primary proof flow) that the backend already treats as independently reviewable
but that had no frontend surface at all — not grouped, not flat, not visible. See "Secondary
review surface for benchmark submissions" under Design/Architecture. This channel is also the one
`docs/rfc/0006-submission-spam-free-allowance-pricing.md`/ADR-0037/ADR-0038 meter on the backend
(free allowance, pricing, a 100-submission hard ceiling per worker per task, for both bounty and
benchmark) — read this addendum together with that work, though neither depends on the other
shipping first.

This is a client-side presentation change. It does not change the protocol, smart contracts,
database, submission API, submission limits, or settlement semantics.

### Goals

1. One worker occupies one position and one pagination slot in the outer review queue, whether
   they submitted once or 150 times.
2. Every submission remains available in a nested submitter history.
3. The existing gallery/list and swipeable artifact review experience remains intact.
4. A repeated submission cannot move its worker ahead of other workers, replay a new-worker
   animation, or generate repeated global requester notifications.
5. Accept and reject controls appear once per worker and accurately describe their existing
   worker-level behavior.
6. Rejected submissions remain inspectable for audit purposes.

### Success measures

For a task with 161 submissions from 12 workers, including 150 submissions from one worker:

- the outer queue renders 12 worker groups, not 161 submission cards;
- the repeated worker occupies one outer card and one outer pagination slot;
- opening that worker shows all 150 submissions, 10 per nested page;
- the outer artifact gallery contains only representative submissions;
- the nested artifact gallery contains every playable artifact from that worker;
- accepting or rejecting is offered once for that worker, not 150 times; and
- a new revision from that worker does not reorder or globally re-announce the worker.

The first release does not reduce the size or frequency of the API response. Network and backend
scaling must be measured separately.

## Design / Architecture

### Verified current state

Verified on 2026-07-31.

| Area | Current behavior | Gap |
| --- | --- | --- |
| Visibility | `LiveActivityPanel` resolves public or authenticated submissions before rendering. | Grouping must happen after this boundary. |
| Polling | Submission data refreshes every 9 seconds. | Every new submission ID currently participates in animation and toast bookkeeping. |
| Sorting | `sortByReview` sorts a flat submission array by timestamp or worker experience. | A revision can move its worker to the front. |
| Pagination | `PAGE_SIZE` is 10 raw submissions. | One worker can consume every visible slot. |
| Cards | `SubmissionCard` supports gallery and list layouts. | It has no submitter-group or version context. |
| Artifact viewer | `SubmissionGalleryDialog` supports mobile swipe, desktop navigation, arrow keys, and at most three mounted panes. | The outer gallery currently receives artifacts from every submission. |
| Acceptance | The card rewrites the accept command to a worker address. The backend accepts that worker's newest non-rejected submission. | Repeating the payout control on historical rows would imply unsupported version-specific acceptance. |
| Rejection | The protocol rejects by worker. The endpoint marks database rows using exact address text equality. | The generic action targets one suggested worker, casing variants can leave stale row timestamps, and the UI does not confirm the worker-wide effect. |
| Rejected rows | `SubmissionResponse.rejectedAt` is returned, and the list endpoint still returns rejected rows. | The current review UI does not distinguish them. |

The main implementation points are:

- `apps/web/components/market/live-activity.tsx:348`
- `apps/web/components/market/tasks.tsx:1812`
- `apps/web/components/market/tasks.tsx:1867`
- `apps/web/components/market/submission-gallery.tsx:91`
- `apps/web/components/market/actions/reject-submission-button.tsx:19`
- `apps/backend/src/routers/submissions.router.ts:783`
- `apps/backend/src/routers/acceptance.router.ts:74`
- `apps/backend/src/routers/tasks.router.ts:1735`

### Information hierarchy

```text
Submission review
├── Active submitters: one representative card per worker
│   ├── Single submission: current card, unchanged
│   └── Multiple submissions: current card + "View N submissions"
│       └── Inline submitter history
│           ├── Gallery or list of that worker's submissions
│           └── Artifact viewer: existing swipeable Drawer/Dialog
└── Rejected submitters: collapsed, grouped audit history
```

The submitter history is an inline drill-in inside the existing `Submission review` section. It
replaces the outer queue body until the requester selects `Back to all submitters`. It is not a
Drawer, Dialog, Sheet, or new route.

This keeps gallery/list review full-width on every breakpoint and leaves the existing artifact
viewer as the only overlay. It avoids nested focus traps, mobile swipe-dismiss conflicts, and a
narrow desktop Sheet.

### Scope activation

Worker grouping applies only when the submission collection is in a review lifecycle:

```ts
const contestReviewLifecycle =
  task.mode === 'bounty' && (task.status === 'open' || task.status === 'pending_approval');

const submissionReviewEligible =
  activeMode(task) === 'submissions' &&
  (contestReviewLifecycle || Boolean(acceptAction || rejectAction));
```

`TaskDetailPanel` extracts the requester `accept` and `reject_submission` actions independently of
the SSR submission rows and passes them to the always-mounted mode panel. When
`submissionReviewEligible` is true, those actions are removed from the generic
`TaskActionsPanel`; the review surface owns their loading and placement.

`LiveActivityPanel` decides whether there are groups to render only after `visibleSubmissions`
resolves the current public or authenticated visibility scope. This covers private submissions
that are empty during SSR and arrive through the authenticated poll.

Before a visible worker group exists, the review surface shows its current loading or empty state
and does not render a worker-targeted action. It must not fall back to the server's suggested
worker merely to fill that gap.

The open bounty lifecycle remains review-eligible after every worker is rejected, even when the
server no longer returns accept or reject pending actions. This keeps `Rejected submitters`
available until the task leaves the open or pending-approval lifecycle.

The flat activity feed used outside a decision queue does not change in this milestone. Pitches,
proofs, bids, and claims do not change.

### Secondary review surface for benchmark submissions

`submissionReviewEligible` is gated on `activeMode(task) === 'submissions'`. For a `benchmark`
task, `activeMode(task)` returns `'proofs'` — the primary feed and this milestone's grouping never
apply to benchmark, by the same logic that already excludes pitches, bids, and claims from
grouping.

That gate was correct for the *primary* feed, but benchmark tasks have a second, independent
submissions channel that this spec initially missed entirely. `taskmarket task submit` is
available on benchmark tasks as an optional additional artifact delivery alongside the primary
`taskmarket task proof` flow (see the platform skill doc). The backend already treats these
submissions as a first-class, independently reviewable channel:
`contestHasSubmissions = (task.mode === 'bounty' || task.mode === 'benchmark') &&
task.submissionCount > 0` (`apps/backend/src/lib/task.ts`) generates the exact same `accept` and
`reject_submission` requester pending actions for benchmark submissions that it generates for
bounty. Verified directly: before this addendum, no frontend surface renders those submissions at
all — not grouped, not as flat cards, not anywhere. A benchmark task's optional submissions
channel is backend-reviewable but frontend-invisible. This predates this spec's own milestone and
is not introduced by it, but landing worker-grouping for bounty without also giving benchmark's
already-actionable submissions *any* review surface leaves a real, adjacent gap unaddressed while
touching the exact same code.

This is additive, not a change to the `submissionReviewEligible` gate above. The primary feed for
a benchmark task (proofs) is unaffected — flipping `activeMode` or `submissionReviewEligible` for
benchmark would incorrectly replace the proof feed with submission groups, which is wrong; proofs
stay primary.

```ts
const benchmarkSubmissionReview =
  task.mode === 'benchmark' &&
  (task.submissionCount ?? 0) > 0 &&
  Boolean(acceptAction || rejectAction);
```

`acceptAction`/`rejectAction` are the same `TaskDetailPanel`-level lookups already used for
`submissionReviewEligible` — no new pending-action parsing. `LiveActivityPanel` receives this as a
new, separate prop (e.g. `secondarySubmissionReview`), independent of `submissionReviewEligible`.

When true, render a collapsed-by-default disclosure below the primary proof feed:

```text
Additional submissions (N)
```

Opening it reuses `groupSubmissionsByWorker`, `WorkerSubmissionActions`, and
`WorkerSubmissionHistory` verbatim — the same components, same grouping rules, same worker-wide
rejection semantics, same confirmation copy — fed from `modeData.submissions` instead of
`modeData.proofs`. It owns its own `selectedWorkerKey`, its own pagination, and its own polling
bookkeeping, entirely independent of the primary feed's state, so opening or paginating it never
touches proof-feed animation, toasts, or focus. Reuse over reinvention: this section is
deliberately *not* a parallel reimplementation — the same grouping/action/history contract this
spec already defines for bounty is directly reusable here because the underlying data shape
(`SubmissionResponse`) and backend actions are identical.

Because this channel is optional and expected to be low-volume relative to a benchmark's primary
proof flow, the section defaults collapsed and does not participate in the primary feed's
new-arrival animation or global toast — a local, polite live-region count update on the disclosure
label is sufficient (`Additional submissions (N)` updates in place).

`Rejected submitters` for this secondary channel follows the same rules as the primary queue —
collapsed audit history below the active groups, worker-wide rejection, no active-page
consumption.

**Relationship to RFC-0006** (`docs/rfc/0006-submission-spam-free-allowance-pricing.md`,
`docs/adr/0037-tier-2-hard-ceiling-is-100-submissions.md`, `docs/adr/0038-rate-limiting-is-a-shared-module-not-per-feature-bespoke-logic.md`):
that work meters exactly this channel on the backend — a free allowance, then pricing, then a hard
ceiling of 100 submissions per `(worker, task)` — for both bounty and benchmark submissions. This
addendum is the frontend counterpart for benchmark specifically: RFC-0006 bounds how many
submissions a worker can accumulate on this channel; this addendum makes those submissions (up to
that bound) actually visible and reviewable, the same gap RFC-0006's own References already
flagged PR #369 as the bounty-side answer to. Neither depends on the other shipping first — the
review surface is useful with or without the backend cap, and the cap is useful with or without
review UI — but both address the same channel and should be read together.

### Grouping boundary and identity

Grouping occurs after `visibleSubmissions` has applied the current public or authenticated
visibility rules. It must never operate on data that the current viewer was not already allowed to
receive.

The group key is:

```ts
const workerKey = submission.workerAddress.toLowerCase();
```

The client must not group by `workerAgentId`. Agent metadata can be absent, stale, or shared
incorrectly. The wallet address is the protocol identity used by acceptance and rejection.

Address casing differences do not create separate groups. The original address from the
representative submission is retained for display and action payloads.

The current database stores the submitted address text and acceptance/rejection lookups use exact
text equality. There is no verified canonical-casing invariant. The UI therefore must not assume
that an exact-case database update touches every casing variant.

Rejection itself is worker-wide on-chain, where address casing has no meaning. If any row in a
normalized worker group has `rejectedAt`, classify the entire group as rejected in the client.
Rows without a rejection timestamp remain visible in that rejected history, but they are not
treated as active work. This handles legacy casing artifacts without a backend or protocol change.

### Group data model

Create a pure client module at `apps/web/lib/market/submission-review.ts` with this public
contract:

```ts
import type { SubmissionResponse } from '@taskmarket/shared';

export type SubmissionReviewSort = 'newest' | 'oldest' | 'credibility';

export type WorkerSubmissionGroup = {
  workerKey: string;
  workerAddress: string;
  submissions: SubmissionResponse[];
  representativeSubmission: SubmissionResponse;
  firstSubmittedAt: string;
  latestSubmittedAt: string;
  rejected: boolean;
  workerStats: SubmissionResponse['workerStats'];
};

export type SubmissionReviewGroups = {
  activeGroups: WorkerSubmissionGroup[];
  rejectedGroups: WorkerSubmissionGroup[];
  activeSubmissionCount: number;
  rejectedSubmissionCount: number;
  totalSubmissionCount: number;
};

export function groupSubmissionsByWorker(
  submissions: readonly SubmissionResponse[]
): SubmissionReviewGroups;

export function sortSubmissionGroups(
  groups: readonly WorkerSubmissionGroup[],
  sort: SubmissionReviewSort
): WorkerSubmissionGroup[];
```

The contract has these invariants:

1. `submissions` is a new array and never mutates the API response.
2. Each group's submissions are sorted by `submittedAt` descending, then `id` ascending.
3. `representativeSubmission` is the newest submission. It is used in the active queue only when
   `rejected` is false and in the rejected archive only when `rejected` is true.
4. `firstSubmittedAt` is the earliest submission in the complete group, including any rejected
   history. Mixed legacy data must not let a later active row reset the worker's queue position.
5. `latestSubmittedAt` is the newest submission timestamp in the group.
6. `workerStats` comes from the representative submission.
7. `rejected` is false only when every row has no `rejectedAt`.
8. `rejected` is true when any row has `rejectedAt`, because the underlying rejection decision is
   worker-wide.
9. A rejected group retains every row. A row without its own `rejectedAt` is labelled
   `Rejected with submitter` rather than presented as active.
10. Invalid timestamps sort after valid timestamps and fall back to submission ID ordering. The
    API should supply valid ISO timestamps, but malformed data must not make ordering unstable.

### Outer queue

The outer queue is a list of `activeGroups`.

#### Representative card

The representative is the newest active submission, so the requester immediately sees the latest
work without losing older versions.

For a group with one submission in total, render the current `SubmissionCard` without extra group
chrome. This is the main no-regression requirement.

For a group with more than one submission in total:

- render the same current card with the representative submission;
- add a separate `View N submissions` button;
- use the accessible name `View all N submissions from <worker label>`;
- display `N submissions` as neutral factual copy;
- do not label the worker or submissions as spam, duplicate, suspicious, or low quality; and
- do not make the whole card clickable.

`SubmissionCard` already contains profile links, artifact buttons, disclosures, and payout
controls. Wrapping it in another interactive element would create invalid nested interaction.

#### Counts

Above the queue, show both dimensions:

```text
12 active submitters · 161 active submissions
```

Use correct singular forms. The existing task metric remains the raw submission count. The new
review summary explains why the number of outer cards is lower. When no rejected archive exists,
the shorter `12 submitters · 161 submissions` form is allowed.

#### Sorting

Replace the review labels with:

- `Newest submitters`
- `Oldest submitters`
- `Most experienced worker`

`Newest submitters` and `Oldest submitters` sort by `firstSubmittedAt`, not
`latestSubmittedAt`. A worker's revisions therefore cannot bump that worker ahead of other
submitters.

Sort rules are deterministic:

| Sort | Primary | Secondary | Final tie-break |
| --- | --- | --- | --- |
| Newest | `firstSubmittedAt` descending | none | `workerKey` ascending |
| Oldest | `firstSubmittedAt` ascending | none | `workerKey` ascending |
| Credibility | `completedTasks` descending, missing as `-1` | `firstSubmittedAt` ascending | `workerKey` ascending |

Changing sort resets the outer page to 1.

#### Pagination

Keep `PAGE_SIZE = 10`, but paginate active worker groups. Pagination copy uses submitters:

```text
Showing 1-10 of 12 submitters
```

If polling or rejection makes the current page invalid, clamp it to the last valid page. A worker
with 150 submissions occupies one slot.

#### Outer artifact gallery

Build outer gallery entries from `representativeSubmission` for each sorted active group. Do not
include older submissions.

The gallery remains artifact-level. A representative submission with three playable artifacts
contributes three slides. A representative with no playable artifacts contributes no slide; the
client must not silently substitute media from an older submission.

Correct the artifact viewer's assistive labels from `Previous submission` and `Next submission` to
`Previous artifact` and `Next artifact`. Visible and live-region position copy remains
`Item X of Y` unless a separate artifact/submission counter can be added without changing the
navigation model.

### Inline submitter history

Create `apps/web/components/market/worker-submission-history.tsx`.

The outer `LiveActivityPanel` owns `selectedWorkerKey`. When a multi-submission button is
activated, it renders `WorkerSubmissionHistory` in place of the outer toolbar, group grid, and
outer pagination. The section heading and outer state remain mounted.

The history header contains:

- a `Back to all submitters` button;
- the existing worker or agent profile link;
- `<N> submissions`;
- `First submitted <relative time>`;
- `Latest update <relative time>`;
- an `Active` or `Rejected` status; and
- the one worker-level action area when the connected wallet is the requester.

Entering history moves focus to its heading. Returning moves focus to the exact
`View N submissions` button that opened it, using `focus({ preventScroll: true })` where
supported. The history heading has `tabIndex={-1}` so it can receive programmatic focus.

On entry, capture the outer window scroll position and the origin:

```ts
type SubmitterHistoryOrigin = {
  kind: 'active' | 'rejected';
  workerKey: string;
  page: number;
  scrollY: number;
};
```

On Back, render the origin list first, restore `window.scrollY` without smooth animation, then
restore focus. Outer sort, page, view, rejected-disclosure state, and origin context remain
unchanged.

The history is not a modal:

- Escape does not leave it;
- browser Back does not change it;
- `Back to all submitters` is the explicit exit; and
- opening an artifact still uses the existing mobile Drawer or desktop Dialog.

If polling removes the selected worker from visible data, return to the outer queue, focus the
`Submission review` heading, and announce `This submitter is no longer available`. If polling
moves the group to rejected, keep the history open as read-only, display `Rejected`, remove
decision actions, and let the requester return explicitly.

When Back is selected after an active group became rejected:

1. expand the `Rejected submitters` disclosure;
2. select the rejected page containing that worker;
3. restore focus to that group's `View history` button;
4. if that control is unavailable, focus the `Rejected submitters` summary; and
5. if the summary is unavailable, focus the `Submission review` heading.

#### Nested controls

History initializes its view from the outer `gallery` or `list` choice each time it opens. It then
owns independent state so changing the nested view does not change the outer choice.

History provides:

- the same `Gallery` and `List` controls with `aria-pressed`;
- `Newest submissions` and `Oldest submissions` sorting;
- newest first by default;
- independent 10-submission pagination; and
- pagination copy such as `Showing 1-10 of 150 submissions`.

Changing nested sort resets only the nested page to 1.

Credibility is not a nested sort option because every row belongs to the same worker.

#### Historical cards

Reuse `SubmissionCard` for each submission. `WorkerSubmissionHistory` owns this wrapper context:

```ts
type SubmissionVersionContext = {
  ordinal: number;
  total: number;
  latest: boolean;
};
```

The history component wraps each existing `SubmissionCard` in a labelled section without changing
`tasks.tsx`:

- the wrapper label is `Submission <ordinal> of <total> from <worker label>`;
- the newest active submission has a visible `Latest active` badge;
- older rows use neutral version-history language; and
- rejected histories show a visible `Rejected` or `Rejected with submitter` badge and no actions.

The ordinal describes chronological submission order, where 1 is the earliest submission and
`total` is the latest. It remains the same when the user changes nested sort.

Historical cards never receive `reviewAction`. They are inspection-only. No payout or rejection
control may repeat on every row. The wrapper provides the unique accessible version label; the
inner `SubmissionCard` keeps its current structure.

Submissions without artifacts remain visible with the current no-artifact copy and no `Open`
button.

#### Nested artifact gallery

For an active group, build nested gallery entries from all active submissions in that group, not
only the nested page. Rejected groups use a separate rejected-only gallery session labelled
`Rejected submission history`. Active and rejected artifacts never share one swipe sequence.

This keeps swipe review continuous across the relevant history while card rendering stays
paginated. A worker group is never partly active under the worker-wide rejection rule.

The existing viewer still:

- opens at the selected hero or thumbnail;
- supports arrow keys, chevrons, and 48-pixel horizontal edge swipes;
- ignores mostly vertical gestures;
- preserves interactive HTML touch input;
- mounts at most the previous, current, and next panes;
- preserves untrusted HTML warnings and sandboxing; and
- honors reduced motion.

A history with 150 submissions may create an in-memory entry list for all playable artifacts, but
must mount no more than three artifact panes.

### Gallery session stability

The representative artifact list can change while an outer gallery is open. If a new revision
replaces the selected representative, the selected artifact disappears from the newly derived
list and the current implementation falls back to the first artifact. That can interrupt video,
HTML, or image review.

Add optional session controls to `SubmissionGalleryDialog`:

```ts
type SubmissionGalleryEntryPolicy = 'live' | 'snapshot-membership';

type SubmissionGallerySessionProps = {
  contextLabel?: string;
  entryPolicy?: SubmissionGalleryEntryPolicy;
  sessionKey?: string;
};
```

The default is `live` to preserve all existing call sites.

Grouped outer and nested review use `snapshot-membership`. On open:

1. capture the ordered artifact IDs and fallback entry objects;
2. retain that membership and order until close;
3. for captured IDs still present in new props, use their latest metadata and refreshed preview
   URLs;
4. for captured IDs no longer present, retain the captured entry object;
5. ignore newly inserted IDs until the gallery closes; and
6. capture a fresh snapshot the next time it opens.

This freezes navigation without freezing URL refreshes.

`sessionKey` identifies the authorization scope:

```ts
const sessionKey =
  `${task.id}:${task.submissionVisibility}:${authenticatedAddress ?? 'public-or-anonymous'}`;
```

When `sessionKey` changes, close the gallery, clear selected and captured entries, and discard
fallback objects before rendering data from the new scope. Retaining a removed entry is allowed
only for representative churn inside the same authorization scope.

`contextLabel` is omitted for active review and set to `Rejected submission history` for rejected
audit sessions. It is visible in both mobile and desktop viewer headers.

### Live polling, animation, and announcements

Do not change the raw `liveItems()` path used by task activity summaries or non-submission modes.
Create submission-review-specific bookkeeping keyed by `workerKey`.

At initial render or the first authenticated visibility response:

- seed all visible worker keys;
- do not animate or announce them; and
- preserve the current private-submission baseline behavior.

On later polls:

| Change | Outer card | Outer position | Animation | Global toast/live region |
| --- | --- | --- | --- | --- |
| New submission from existing worker | Update count and representative | Unchanged under first-arrival sorts | None | None |
| Many submissions from existing worker | One updated group | Unchanged | None | None |
| First submission from new worker | Add one group | Based on first submission | Once | `New submitter from <worker>` |
| Multiple new workers in debounce window | Add one group per worker | Based on first submission | Once each | `<N> new submitters` |
| Address casing changes | Update existing group | Unchanged | None | None |

While the selected worker history is open, new submissions from that worker update its count and
representative without changing nested view, sort, page, focus, scroll, or an open artifact
session. Announce one local polite message per poll batch:

```text
3 new submissions added
```

Do not emit both the local message and a global toast for the same revision.

Non-requesters continue to receive no requester toast. Reduced-motion mode continues to skip
motion wrappers.

On task ID, authenticated address, or visibility-scope change, reset:

- selected worker and history origin;
- active and rejected page state;
- seeded and seen worker-key sets;
- pending debounce batches and timers;
- local history announcements; and
- open artifact sessions.

An old-scope response or pending debounce callback must not render or announce after the reset.

### Worker-level decision actions

Acceptance and rejection are worker-level decisions. The UI must render each at most once per
active worker group.

Create `apps/web/components/market/worker-submission-actions.tsx`. It composes the existing payout
action and the targeted rejection action behind one contract.

In the outer queue, render `WorkerSubmissionActions` immediately below the representative card for
every active group, including a single-submission group. The representative card's content and
layout stay unchanged, but it does not render its old embedded `reviewAction`.

When history is open, the outer card is not mounted. Render the same one action component in the
history header. Historical cards remain action-free. This preserves the swipe-and-decide workflow
while guaranteeing that only one action set is visible.

#### Acceptance

Keep the existing `SubmissionPayoutAction` and requester wallet/funding guards. Rewrite the accept
command to the selected group's `workerAddress`.

The action area must state:

```text
Releases payout to this worker using their latest active submission.
```

Do not claim that opening or selecting a historical row changes the accepted deliverable. The
single-accept endpoint currently resolves the newest non-rejected submission for the worker.
Version-specific acceptance is not part of this milestone.

#### Rejection

Extend `RejectSubmissionButton` with an optional explicit target:

```ts
type WorkerRejectionTarget = {
  workerAddress: string;
  activeSubmissionCount: number;
};
```

When this target is supplied, it takes precedence over parsing `--worker` from the server command.
The request remains:

```ts
{
  taskId: task.id,
  worker: target.workerAddress,
}
```

The grouped action label is:

```text
Reject submitter and all N submissions
```

Before any payment or signature request, require confirmation with:

```text
Reject this submitter?

All N submissions from <worker> will be rejected. This worker cannot submit again to this task.
The relay fee is 0.001 USDC.
```

Confirmation and cancel are separate buttons. Closing or cancelling the confirmation performs no
network, wallet, or payment action.

The target mode is self-contained. Before showing or running the action,
`RejectSubmissionButton` must:

- verify that the connected address matches `task.requester`;
- preserve the disconnected and wrong-wallet states;
- run `usePaidActionFundingPrompt`;
- show the existing `FundingGuard` when the requester lacks the action fee; and
- respect its existing `disabled` prop.

The generic `TaskActionsPanel` path does not pass `target` and retains its existing parent funding
and visibility guards. Tests must prove that the grouped target path does not lose those guards.

On success:

- call `onRejectSuccess(workerKey)` before closing any confirmation UI;
- add the worker key to an optimistic rejected-key set owned by `LiveActivityPanel`;
- invalidate the public submissions query or immediately rerun the authenticated scoped fetch;
- refresh the task so pending actions update;
- move the group to `Rejected submitters`;
- keep any currently open history as a read-only rejected history;
- remove accept and reject actions from that group; and
- preserve all other groups and outer state.

The optimistic key is cleared once refreshed data contains any rejected row for that normalized
worker. `router.refresh()` alone is not sufficient because authenticated submissions use local
polling outside the shared React Query cache.

On API failure or wallet rejection, keep the group active. Preserve the current behavior where a
user-rejected wallet request does not produce a false error toast.

### Rejected submitters

Rejected groups do not consume active queue pagination slots and do not appear in the outer
artifact gallery.

Below the active queue, render a collapsed native disclosure:

```text
Rejected submitters (N)
```

When opened:

- show one compact row per rejected worker;
- paginate rejected workers at 10 per page when needed;
- show worker identity, rejected submission count, first/latest timestamps, and `View history`;
- allow the same inline history drill-in in read-only mode; and
- show no accept or reject controls.

If every group is rejected, show:

```text
No active submissions to review.
```

The collapsed rejected disclosure remains available below it.

### Responsive behavior

The inline outer and nested views use the same responsive width as the current review section.

- Below `md`, gallery cards remain one column and list cards use their current stacked layout.
- At `md` and above, gallery cards remain two columns.
- Controls wrap without horizontal scrolling.
- Touch targets follow the existing button sizes and the frontend guide.
- The artifact viewer remains a 96dvh mobile Drawer and a wide desktop Dialog.
- No nested Drawer, Dialog, or Sheet is introduced.

### State ownership

`LiveActivityPanel` owns:

- resolved visible submissions;
- grouped active/rejected data;
- outer sort, view, active page, rejected page, and rejected-disclosure state;
- selected worker key;
- submitter history origin and captured scroll position;
- optimistic rejected worker keys;
- outer gallery state;
- group-key seed, animation, toast, and live-region bookkeeping; and
- focus restoration references for submitter buttons.

`WorkerSubmissionHistory` owns:

- nested sort, view, and page;
- nested artifact gallery state;
- local revision announcement bookkeeping; and
- history heading focus.

`SubmissionGalleryDialog` owns:

- selected artifact;
- snapshot-membership session state;
- preview loading;
- swipe and keyboard navigation; and
- artifact live-region announcements.

### What is working well and must not change

- Visibility-gated submissions remain absent until authenticated and clear on account switch.
- Polling stops for terminal tasks.
- Single-submission worker cards retain their current layout and interaction.
- Profile links, artifact preview controls, supporting-file disclosures, and award badges remain.
- The artifact viewer keeps windowed three-pane mounting, URL refresh behavior, playback
  stability, swipe gutters, keyboard controls, and reduced-motion handling.
- Interactive HTML remains sandboxed and visibly marked as untrusted.
- Requester-only actions keep their wallet, chain, and funding guards.
- The raw task submission metric remains truthful.
- Bid, pitch, proof, claim, and non-review activity behavior remains unchanged.

### Milestones and parallel child issues

Each child issue is intended to fit within one to three engineering days. File ownership is
exclusive within a wave so separate implementation agents do not edit the same integration files.

#### Wave 0: grouping contract

| ID | Priority | Scope | Exclusive file ownership | Depends on |
| --- | --- | --- | --- | --- |
| SR-1 | Critical | Pure case-insensitive grouping, worker-wide rejected classification, representative selection, counts, stable sorts, and exported types | New `apps/web/lib/market/submission-review.ts` and `.test.ts` | This spec |

Land SR-1 first. It is the shared compile-time contract for the parallel UI work.

#### Wave 1: parallel interaction surfaces

| ID | Priority | Scope | Exclusive file ownership | Depends on |
| --- | --- | --- | --- | --- |
| SR-2 | High | Inline submitter history, independent controls/pagination, wrapper-owned version context, focus/scroll entry and return, and read-only rejected history | New `apps/web/components/market/worker-submission-history.tsx` and `.test.tsx` | SR-1 |
| SR-3 | High | Snapshot-membership artifact sessions, authorization-scope reset, rejected context label, and accurate artifact navigation labels | `apps/web/components/market/submission-gallery.tsx` and `.test.tsx` | SR-1 for scope fixtures only |
| SR-4 | Critical | Worker action composition, exact command targeting, self-guarded rejection, confirmation, success callback, payout copy, and focused tests | New `apps/web/components/market/worker-submission-actions.tsx` and test; `actions/reject-submission-button.tsx` and test; `actions/submission-payout-action.tsx` and test; new `apps/web/lib/market/task-action-command.ts` and test | SR-1 |

SR-2 through SR-4 can run at the same time after SR-1 lands. `WorkerSubmissionHistory` accepts an
`actionArea` node, so it does not depend on SR-4. It wraps `SubmissionCard` rather than changing
`tasks.tsx`, so its exclusive ownership is real and its tests compile independently.

#### Wave 2: integration

| ID | Priority | Scope | Exclusive file ownership | Depends on |
| --- | --- | --- | --- | --- |
| SR-5 | Critical | Group before sort/pagination/gallery, extract review actions, render one card/action per worker, inline drill-in, group-level polling/toasts, and task-detail regression updates | `apps/web/components/market/live-activity.tsx`, `live-activity.test.tsx`, `tasks.tsx`, and `tasks.test.tsx` | SR-1 through SR-4 |
| SR-6 | High | Large grouped-review fixture and desktop/mobile production E2E journey | `apps/web/e2e/mock-api.ts`, new `apps/web/e2e/grouped-submission-review.spec.ts`, and `apps/web/e2e/critical-mobile.spec.ts` | Stable SR-5 selectors; fixture work can start earlier |

Only one agent should own SR-5. `live-activity.tsx` and `tasks.tsx` are the two high-conflict
integration files.

#### Wave 3: benchmark secondary review surface

| ID | Priority | Scope | Exclusive file ownership | Depends on |
| --- | --- | --- | --- | --- |
| SR-7 | High | `benchmarkSubmissionReview` eligibility, collapsed `Additional submissions (N)` disclosure, wiring `groupSubmissionsByWorker`/`WorkerSubmissionActions`/`WorkerSubmissionHistory` to `modeData.submissions` for benchmark tasks, independent state/polling from the primary proof feed | `apps/web/components/market/live-activity.tsx`, `live-activity.test.tsx`, `tasks.tsx`, and `tasks.test.tsx` (same files as SR-5 — must land after SR-5, not in parallel with it) | SR-5 |

SR-7 reuses SR-1 through SR-4's components verbatim; it adds no new component files, only a new
call site and eligibility check inside the files SR-5 already integrated. Sequenced strictly after
SR-5 (same-file conflict, not a parallelizable wave) rather than folded into SR-5 itself, so SR-5's
own bounty-focused integration lands and is reviewable on its own first.

#### Dependency graph

```text
SR-1 grouping ──┬──> SR-2 history ──┐
                ├──> SR-3 gallery ──┼──> SR-5 integration ──> SR-6 E2E and UI gate
                └──> SR-4 actions ──┘         │
                                               └──> SR-7 benchmark secondary surface
```

#### Sequencing rationale

SR-1 fixes and lands the shared data contract before parallel UI agents begin. SR-2, SR-3, and
SR-4 then isolate the three interaction-heavy surfaces behind contracts and focused tests. SR-5
becomes composition and live-state integration rather than one large unreviewable rewrite. SR-6
runs after stable selectors and behavior exist, while its mock fixture can be prepared in
parallel. SR-7 extends the same integration to benchmark's secondary submissions channel once SR-5
has landed — it is scoped and sequenced separately rather than bundled into SR-5 so the primary
bounty milestone isn't blocked on, or entangled with, verifying a second, lower-traffic mode.

#### Milestone exit criteria

Milestone 1, grouping contract:

1. SR-1 tests pass independently.
2. The helper groups 150 same-address submissions into one group.
3. Any rejected row classifies the normalized worker group as rejected.

Milestone 2, parallel interaction surfaces:

1. SR-2 through SR-4 tests pass independently.
2. The history component renders 150 submissions in 15 pages without an overlay.
3. The artifact viewer retains a selected removed representative until close in the same
   authorization scope.
4. Rejection makes no request before explicit confirmation.
5. Grouped rejection preserves requester and funding guards.

Milestone 3, integrated review queue:

1. Outer sorting, paging, gallery entries, animation, and announcements operate on worker groups.
2. Single-submission cards remain visually and behaviorally unchanged.
3. Nested state and focus return work on desktop and mobile.
4. Accept and reject controls appear once per worker.
5. Rejected groups remain inspectable and do not occupy active pages.

Milestone 4, release gate:

1. The large repeated/rejected fixture passes desktop and mobile E2E.
2. No horizontal overflow occurs at 320, 390, or 430 CSS pixels.
3. Existing gallery, private visibility, HTML sandbox, payout, and non-submission-mode tests pass.
4. `make ui-ci` passes.

Milestone 5, benchmark secondary review surface:

1. A benchmark task with submissions renders `Additional submissions (N)` below the proof feed;
   a benchmark task with zero submissions renders nothing extra.
2. Opening the disclosure groups by worker using the same rules as the primary queue (case-
   insensitive address, worker-wide rejection, representative selection).
3. Accept and reject on this surface use the existing `accept`/`reject_submission` pending actions
   already generated for benchmark by `contestHasSubmissions` — no new backend call, no new
   command shape.
4. The primary proof feed's polling, animation, and toast state are unaffected by opening,
   paginating, or acting within the secondary surface, and vice versa.
5. A bounty task, and a benchmark task with zero submissions, render byte-identical to before this
   milestone — this is strictly additive.

### Rollback

This change has no data migration or protocol state. Reverting the frontend changes restores the
flat review queue. Submitted, rejected, accepted, and paid protocol state remains unchanged.

SR-7 rolls back independently of SR-1 through SR-6: removing the `benchmarkSubmissionReview` call
site restores benchmark tasks to today's behavior (submissions on that channel remain
backend-reviewable via the generic accept/reject action, just not visually browsable) without
touching the primary bounty milestone at all.

If a partial rollback is needed, disable grouped review at the
`submissionReviewEligible` branch and leave the pure helper and tests in place. Do not alter
backend data to match the old presentation.

## Interfaces / Contracts

### Component contract

`WorkerSubmissionHistory` accepts:

```ts
type WorkerSubmissionHistoryProps = {
  actionArea?: React.ReactNode;
  group: WorkerSubmissionGroup;
  initialView: 'gallery' | 'list';
  onBack: () => void;
  profileBasePath: string;
  task: TaskDetailResponse | TaskResponse;
  visibilityScopeKey: string;
};
```

It renders inline and owns no route or open/closed prop. Mounting means the history is active.

`SubmissionGalleryDialog` adds:

```ts
type SubmissionGalleryDialogProps = {
  // Existing props remain.
  contextLabel?: string;
  entryPolicy?: SubmissionGalleryEntryPolicy;
  sessionKey?: string;
};
```

The default `entryPolicy` is `live`, and the default `sessionKey` is `taskId`. Grouped review must
supply the authorization-aware key.

`RejectSubmissionButton` adds:

```ts
type RejectSubmissionButtonProps = TaskActionComponentProps & {
  action?: { command: string };
  target?: WorkerRejectionTarget;
};
```

Existing generic `TaskActionsPanel` calls do not supply `target` and retain their current command
parsing behavior.

`WorkerSubmissionActions` accepts:

```ts
type WorkerSubmissionActionsProps = {
  acceptAction?: PendingAction;
  group: WorkerSubmissionGroup;
  onRejectSuccess: (workerKey: string) => void;
  rejectAction?: PendingAction;
  task: TaskDetailResponse | TaskResponse;
};
```

It renders nothing for a rejected group. For an active group it rewrites the accept command with:

```ts
export function commandForTaskWorker(command: string, workerAddress: string): string;
```

This helper lives at `apps/web/lib/market/task-action-command.ts` and replaces the local
`commandForSubmissionWorker` implementation in `tasks.tsx`.

### Action wiring contract

`TaskDetailPanel` derives:

```ts
type SubmissionReviewActions = {
  acceptAction?: PendingAction;
  rejectAction?: PendingAction;
};
```

Both action candidates are passed through `ModeDataPanel` to `LiveActivityPanel` independently of
initial submission rows. When `submissionReviewEligible` is true, they are not also passed to
`TaskActionsPanel`.

For every group action, the client rewrites or explicitly overrides the worker using
`group.workerAddress`. It never trusts the server's one suggested worker to identify every card.

### Copy contract

Required user-facing terms:

- top-level unit: `submitter`;
- nested unit: `submission`;
- action: `View N submissions`;
- outer sort: `Newest submitters`, `Oldest submitters`, `Most experienced worker`;
- nested sort: `Newest submissions`, `Oldest submissions`;
- archive: `Rejected submitters`;
- destructive action: `Reject submitter and all N submissions`; and
- payout explanation: `Releases payout to this worker using their latest active submission.`

The interface never labels a worker as spam based only on count.

### Selector contract

Add stable selectors for production E2E:

```text
data-testid="submission-review-summary"
data-testid="submitter-group-<normalized-address>"
data-testid="submitter-history"
data-testid="submitter-history-back"
data-testid="rejected-submitters"
```

Do not use dynamic submission counts or visible copy as the only E2E locator.

### Performance contract

For `S` visible submissions and `W` workers:

- grouping and sorting may use `O(S log S)` client time and `O(S)` memory;
- the outer DOM renders at most 10 worker cards per page;
- the nested DOM renders at most 10 submission cards per page;
- the artifact viewer mounts at most three media panes;
- outer gallery membership is based on `W` representative submissions; and
- the client still fetches the complete flat response and its requested media preview URLs.

No client-side virtualization is required for this milestone.

## Security & Privacy considerations

1. Group only after the existing visibility filter. Grouping must not make private submissions
   visible through counts, representative cards, gallery entries, or announcements.
2. Normalize wallet casing only for identity comparison. Preserve the selected group's actual
   address in acceptance and rejection payloads.
3. Never group by display name or agent ID.
4. Never automatically hide, reject, deprioritize, or label a worker because of submission count.
   A high count is a navigation signal, not a trust verdict.
5. Rejection is requester-only, paid, worker-wide, and prevents resubmission. Require confirmation
   before wallet or payment work begins.
6. Historical cards cannot imply version-specific acceptance because the single-accept endpoint
   resolves the worker's newest active submission.
7. Keep all existing untrusted HTML warnings, sandbox restrictions, network restrictions, and
   preview failure states.
8. Submission text and artifacts are untrusted content. The UI must not turn their contents into
   executable wallet, CLI, or agent instructions.
9. Rejected histories stay within the same submission-visibility boundary as active histories.

## Testing & Verification

### Pure grouping tests

Add `apps/web/lib/market/submission-review.test.ts` with at least these cases:

1. 150 rows from one wallet produce one active group.
2. Checksum and lowercase variants produce one group.
3. Two wallets with the same `workerAgentId` remain separate.
4. History is newest first with submission-ID tie-breaking.
5. The newest active submission is representative.
6. A newer revision changes the representative and count but not `firstSubmittedAt`.
7. Newest, oldest, and credibility sorts follow the specified tie-breaks.
8. A worker with any rejected row appears only in `rejectedGroups`.
9. Mixed timestamp data is retained, but worker-wide rejection prevents any row in that normalized
   group from being presented as active.
10. Inputs and nested submission arrays are not mutated.
11. Counts report active, rejected, and total submissions truthfully.
12. Invalid timestamps remain deterministic.

### Component and integration tests

Extend `apps/web/components/market/tasks.test.tsx` and
`apps/web/components/market/live-activity.test.tsx`:

1. 150 submissions from one worker render one outer card and one
   `View 150 submissions` button.
2. 161 submissions from 12 workers paginate as 12 submitters.
3. A one-submission worker has no history button and retains the current card layout.
4. The representative uses the newest active submission's media and timestamp.
5. Outer gallery entries include representatives only.
6. A no-media latest revision does not borrow older media.
7. Nested history is scoped to the selected normalized address.
8. Nested gallery/list state is independent from outer state.
9. Back restores outer page, sort, view, and opener focus.
10. History pagination renders 10 of 150 submissions and correct immutable ordinals.
11. Historical rows have no payout or reject controls.
12. One worker-level action area targets the selected address.
13. Rejected groups do not consume active pagination and remain inspectable.
14. A selected group that becomes rejected stays open in read-only form.
15. A selected group removed by visibility or account change exits safely.
16. A revision from an existing worker changes count/preview but not outer order, animation, toast,
    or global live-region copy.
17. Many revisions from one existing worker stay globally silent.
18. Three submissions from one new worker create one new-submitter event.
19. Two new workers create one batched `2 new submitters` message.
20. Address casing changes do not create a new-worker event.
21. Private submissions that are empty during SSR enter grouped review after the authenticated
    response arrives.
22. An open bounty with only rejected groups keeps the rejected archive when accept/reject pending
    actions are absent.
23. Extracted review actions do not also render in the generic action panel.
24. A casing-variant group moves to the rejected archive when any returned row records rejection.
25. Task, account, and visibility-scope changes clear selected history, optimistic rejection,
    worker seeds, pending debounce work, and open gallery sessions.
26. An old-account response or pending debounce callback cannot render or announce after a wallet
    switch.
27. Existing bid, pitch, proof, claim, authentication-baseline, non-requester-toast, and
    reduced-motion tests remain unchanged and passing.

Add `apps/web/components/market/worker-submission-history.test.tsx`:

1. Entry focuses the history heading.
2. Back calls `onBack` and integration restores opener focus.
3. Gallery/list controls expose correct pressed states.
4. Nested sort resets only nested pagination.
5. Empty-artifact, supporting-file, video, and interactive HTML submissions render.
6. Latest and rejected badges match immutable version context.
7. New local revisions produce one polite aggregate announcement.
8. Long addresses and filenames remain semantically labelled and do not hide controls in the DOM.

### Gallery regression tests

Extend `apps/web/components/market/submission-gallery.test.tsx`:

1. `live` remains the default entry policy.
2. `snapshot-membership` retains the selected artifact if new props remove it.
3. Captured order does not change when a new worker or revision arrives.
4. Matching captured entries receive refreshed preview metadata.
5. Closing and reopening captures the new representative set.
6. Changing task, account, or visibility scope closes the viewer and drops captured fallback
   entries.
7. A removed entry is never retained across an authorization-scope change.
8. Swipes, chevrons, arrow keys, wraparound, and live announcements remain.
9. Navigation labels say artifact, not submission.
10. Interactive HTML input, warnings, and sandboxing remain.
11. A 150-submission nested entry set still mounts at most three panes.
12. Reduced motion and mobile/desktop surfaces remain unchanged.

### Rejection and payout tests

Add `apps/web/components/market/actions/reject-submission-button.test.tsx` and extend the existing
payout tests:

1. An explicit target overrides a different address or `<address>` in the command.
2. The POST body is exactly `{ taskId, worker: target.workerAddress }`.
3. No POST, payment, signature, or chain-switch call occurs before confirmation.
4. Confirmation names the worker-wide count, resubmission consequence, and 0.001 USDC fee.
5. Cancel and close perform no action.
6. Success calls `onRejectSuccess` with the normalized worker key.
7. Public success invalidates the submissions query and optimistically shows a rejected state.
8. Authenticated success reruns the scoped fetch rather than relying only on router refresh.
9. API failure retains an actionable active state.
10. Wallet rejection does not show a false API error.
11. Disconnected, wrong-wallet, and insufficient-funding guards remain in grouped target mode.
12. Payout command rewriting targets the selected worker.
13. Payout copy states latest-active-submission semantics.
14. Rejected groups offer neither payout nor a second rejection.

### Production E2E

Add a grouped-review fixture in `apps/web/e2e/mock-api.ts`:

- 12 workers;
- one worker with at least 25 revisions;
- one single-submission worker;
- one worker whose newest revision has no media and an older revision has media;
- one fully rejected worker;
- image, video, supporting-file, and interactive HTML artifacts; and
- enough total submissions to distinguish raw count from worker pagination.

Add `apps/web/e2e/grouped-submission-review.spec.ts` for desktop and the existing 390-pixel mobile
projects:

1. Outer summary shows worker and raw active-submission counts.
2. The repeat worker occupies one outer slot.
3. The repeat worker opens inline history.
4. Nested gallery, list, sorting, and pagination work.
5. Artifact swipe/navigation remains scoped to that worker.
6. Back returns to the same outer page and control.
7. Rejected history remains reachable and read-only.
8. Desktop and 390-pixel mobile have no horizontal overflow.
9. Artifact Drawer closes back to history; history then returns through its explicit Back button.
10. Existing untrusted HTML warning and sandbox assertions pass.

Add the grouped-review critical layout journey to `apps/web/e2e/critical-mobile.spec.ts`. The
Playwright configuration restricts the 320-pixel and 430-pixel projects to this file.

1. At 320 and 430 CSS pixels, outer and nested controls fit without horizontal overflow.
2. Buttons meet the existing mobile touch-target rules.
3. Long worker addresses and filenames do not cover action or Back controls.
4. The artifact Drawer opens and closes without a nested-overlay conflict.

Live polling and paid-action request bodies stay in Vitest, not the static mock E2E suite.

### Benchmark secondary review surface tests

Extend `apps/web/components/market/live-activity.test.tsx` and `tasks.test.tsx`:

1. A benchmark task with `task.submissionCount === 0` renders no `Additional submissions`
   disclosure.
2. A benchmark task with submissions renders the disclosure, collapsed by default, with the
   correct count.
3. Opening it groups by worker using the same rules already tested for the primary queue (reuse
   the SR-1 fixtures against this second data source, don't hand-write a parallel fixture set).
4. Accept/reject inside this surface issue the exact same request shape as the primary queue's
   `WorkerSubmissionActions` (same command, same confirmation copy) — a thin wiring test, not a
   re-test of SR-4's own coverage.
5. Interacting with the secondary surface (open, paginate, act) does not change the primary proof
   feed's rendered state, polling timers, or announcement bookkeeping, and vice versa.
6. A bounty task's rendering is byte-identical with and without this milestone's code present —
   confirms the addition is strictly additive, not just "doesn't crash."

### Validation commands

Run project commands through the Makefile:

```bash
make test web
make ui-ci-install-browsers
make ui-ci
```

`make ui-ci-install-browsers` is required only when the local Playwright browsers are absent.
`make ui-ci` is the completion gate for the UI change.

For this spec:

```bash
make lint-check specs
```

### Definition of done

1. One worker with 150 active submissions occupies one outer card and one outer page slot.
2. All 150 submissions are inspectable through inline history.
3. Repeated submissions do not reorder, animate, or globally re-announce an existing worker.
4. A new worker still gets one card, one animation, and one requester announcement.
5. Single-submission card behavior remains unchanged.
6. Outer gallery uses representatives; nested gallery uses the selected worker's full history.
7. Open artifact review is not disrupted by polling or representative replacement.
8. Accept and reject are rendered once per worker and use exact existing worker-level semantics.
9. Rejected submitters remain inspectable and never consume active queue slots.
10. Private visibility, requester authorization, wallet funding guards, and HTML isolation remain
    intact.
11. All specified unit, component, integration, and E2E tests pass.
12. `make ui-ci` passes.
13. A benchmark task's optional submissions channel has a working, tested, worker-grouped review
    surface (Milestone 5) — not left invisible as a known gap.

## Non-goals

- Protocol or smart-contract changes.
- Backend, schema, migration, or API response changes.
- Submission rate limits, upload quotas, fees, cooldowns, or proof-of-work — metered separately by
  RFC-0006/ADR-0037/ADR-0038 on the backend; this spec's Milestone 5 only makes the already-metered
  benchmark submissions channel visible, it does not change what's allowed through it.
- Changing benchmark's primary review surface (proofs) in any way — Milestone 5 is additive only.
- Automatic spam classification, reputation penalties, or hidden risk scores.
- Multi-wallet or Sybil spam prevention.
- Reducing the complete submission payload or presigned preview work.
- Server-side pagination, aggregation, or worker-group endpoints.
- Virtualizing the nested history.
- Version-specific single-submission acceptance.
- Grouping pitches, proofs, bids, claims, or the non-review activity feed.
- Changing the raw submission metric shown in task details.
- Adding a nested-history route, URL parameter, or deep link.
- Changing settlement, rejection, or resubmission protocol behavior.

## References

- `docs/FRONTEND_GUIDE.md`
- `docs/adr/0027-contest-pending-actions-suggest-worker-only-when-unambiguous.md`
- `apps/web/components/market/live-activity.tsx`
- `apps/web/components/market/tasks.tsx`
- `apps/web/components/market/submission-gallery.tsx`
- `apps/web/components/market/actions/submission-payout-action.tsx`
- `apps/web/components/market/actions/reject-submission-button.tsx`
- `packages/shared/src/schemas/submission.schemas.ts`
- `apps/backend/src/routers/submissions.router.ts`
- `apps/backend/src/routers/acceptance.router.ts`
- `apps/backend/src/routers/tasks.router.ts`
- `apps/backend/src/lib/task.ts` (`contestHasSubmissions` — confirms benchmark submissions get the
  same `accept`/`reject_submission` pending actions as bounty; the basis for Milestone 5)
- `docs/rfc/0006-submission-spam-free-allowance-pricing.md`,
  `docs/adr/0037-tier-2-hard-ceiling-is-100-submissions.md`,
  `docs/adr/0038-rate-limiting-is-a-shared-module-not-per-feature-bespoke-logic.md` (backend
  metering of the same benchmark-submissions channel Milestone 5 makes visible; read together, not
  a dependency in either direction)
