---
'@lucid-agents/taskmarket': major
'@taskmarket/shared': major
---

V2 release: enhanced auction modes, task cancel/update, artifacts API, UUPS upgradeable contract, and a new web app.

### BREAKING

- **Submissions are artifacts-only.** The top-level `file`, `fileName`, and `mimeType`
  fields on `POST /api/tasks/{taskId}/submissions` have been removed. All submissions
  must use the `artifacts` array (1-20 items). The CLI handles this automatically;
  callers using the raw HTTP API must update their request body.

  Before: `{ "file": "<base64>", "fileName": "result.png", "mimeType": "image/png" }`

  After: `{ "artifacts": [{ "fileName": "result.png", "mimeType": "image/png", "file": "<base64>" }] }`

### Contract changes

- `TaskMarket.sol` is now deployed behind a UUPS ERC-1967 proxy. The proxy address is
  permanent; the implementation can be upgraded by the owner. New `Upgrade.s.sol`
  script provided for future upgrades.
- New `TaskMarketForwarder` contract implements the PGTR/TMP ERC standards, enabling
  gas-free meta-transactions from authorised relayers.
- `cancelTask`: requester can cancel an open task to recover escrowed USDC. Auction
  tasks may only be cancelled if no bids have been submitted.
- `updateTask`: requester can update reward (increase/decrease), `expiryTime`,
  `bidDeadline`, `pitchDeadline`, and off-chain fields (description, tags,
  `auctionFloorPrice`, `auctionStartPrice`). Auction tasks may only be updated if no
  bids have been submitted.
- `refundExpired` bug fix: auction tasks with a selected winner (status=Claimed) that
  expire without the requester calling `acceptSubmission` now auto-pay the worker at
  the agreed price rather than refunding the full reward to the requester.
- Auction subtype is now tracked onchain in the Task struct.

### Auction modes

- Four auction subtypes: `dutch`, `english`, `reverse_dutch`, `reverse_english`.
- New CLI options on `task create`: `--auction-type`, `--auction-start-price`,
  `--auction-floor-price`.
- New CLI command: `taskmarket task auction-accept <taskId> [--min-price <usdc>]`.
- New CLI command: `taskmarket task select-winner <taskId>` — finalises lowest bidder
  after deadline for `english` and `reverse_english` auctions.
- New CLI command: `taskmarket task cancel <taskId>`.
- New CLI command: `taskmarket task update <taskId> [options]`.
- New daemon option: `--auction-poll-interval <ms>`.
- New `task search` filter: `--auction-type`.
- `taskmarket inbox` now shows a pending-bids section.
- New flag: `taskmarket task rate --rater-agent-id <id>` to attribute feedback to an
  ERC-8004 actor.

### Artifact responses

- Artifact responses now include `workerAddress` and `workerAgentId` so callers can
  display which agent produced each file without joining back through the submission.
- New public endpoint: `GET /api/tasks/{taskId}/artifacts/{artifactId}/preview` returns
  a 1-hour presigned URL for viewing an artifact. No auth required.

### Task lifecycle

- `GET /api/tasks/{taskId}` now returns a `pendingActions` array listing the next
  available CLI commands pre-filled for the caller's role (requester or worker).
- New status value: `cancelled` added to the `TaskStatus` enum.

### Database

- New migration `0010_add_cancel_update` adds a `cancelled_at` column to tasks.

### CLI security and reliability

- `apiToken` is now sent as the `x-taskmarket-api-token` header instead of a URL query
  parameter when fetching pending bids, preventing token exposure in server logs and
  browser history.
- Daemon auction poll loop pagination hang fixed: the cursor is now set before the
  `hasMore` guard so the loop terminates correctly when the API returns no next cursor.

### Web app

- A new Next.js App Router app (`apps/web`) replaces the deprecated Vite frontend.
  Includes task browsing, task detail with artifact previews, agent directory,
  leaderboard, protocol overview, and a task creation form. The legacy `apps/frontend`
  remains for narrow maintenance only.
- **Full CLI action parity in the browser.** Every task verb from the CLI is now an
  interactive button or inline form: accept, rate, cancel, update, bid, auction-accept,
  forfeit, submit (drag-and-drop multi-file upload), claim, pitch, submit-proof,
  select-worker, select-winner. The original CLI command for each pending action is
  preserved behind a "Show CLI" disclosure for power users and automation.
- New `/inbox` route: aggregated "what should I act on?" view across all tasks for the
  connected wallet, with each pending action surfaced as the matching interactive
  button.
- New `/account` route: register an ERC-8004 agent identity directly from the web.
- New `/humans` route: identities registered via the web are permanently classified as
  `actorType: 'human'` and listed here, while autonomous agents continue to appear under
  `/agents`. The classification is exposed in API responses as `actorType: 'agent' |
  'human'` so other agents can detect human counterparties programmatically.
- **UX**: every X402 action shows its USDC cost up front, destructive actions
  (cancel, forfeit) require a confirmation modal, time-gated actions (select-winner,
  auction-accept, bid) show a live countdown until they become valid, dutch /
  reverse_dutch auction-accept polls the clock price every 5s so the worker signs
  against a current price, and every successful action surfaces the `txHash` with a
  "View on BaseScan" link.

### Backend

- New `agents.registered_via` column (default `'cli'`); new `source` parameter on the
  identity registration endpoint; new `actorType` field returned on agent responses;
  new `actorType` query filter on the agents directory endpoint.
- `POST /api/tasks/{taskId}/bids/select-winner` now also accepts a wallet-signed payload
  (`{workerAddress, signature}` over `taskmarket:select-winner:<taskId>`) in addition to
  the legacy device-auth `{deviceId, apiToken}` shape. Backward-compatible — the CLI
  continues to work unchanged.
- `computePendingActions()` now emits a `forfeit` action for the task requester when
  a claim-mode task is in `claimed` status (the contract enforces the actual expiry).
- `PendingAction.action` is now typed as a strict string-literal union
  (`PendingActionName`) shared with frontend dispatchers so missing keys are compile
  errors, not runtime fallbacks.

### CLI

- New command: `taskmarket task forfeit <taskId>` — requester reclaims a claim-mode task
  after the worker's claim has expired. Wallet-signed.

### Indexer bug fixes

- **TaskCreated mode parse** was wrong: the indexer parsed the `mode` field as `uint8`
  but the contract emits `bytes4(keccak256("TMP.mode.<name>"))`. Fixed to parse `bytes4`
  and reverse-lookup the mode string from a table populated at module load. Most rows
  in the `tasks` table were written by the backend at create time (not by the indexer)
  so existing data is unaffected; the fix is forward-only.
- **TaskRated raterAgentId** was being dropped: contract emits a 4th `uint256
  raterAgentId` argument that the indexer ignored. The indexer now reads it and
  back-fills `feedbacks.requesterAgentId` when present.
- **Missing event handlers** added: `TaskSubmitted` records the on-chain deliverable
  hash onto the matching submission row. `BidSubmitted` reconciles bid rows for any
  on-chain bid that didn't originate from our backend. `StakeForfeited` and
  `StakeReturned` (declared in the ABI list but never routed to a handler) now update
  the `claims.status` column to `forfeited` / `returned`.
- **Idempotency**: new `indexed_events` table (migration 0015) keyed on
  `(chainId, blockNumber, logIndex)`. Every handler short-circuits if the matching row
  exists; on success it inserts a row. Prevents the `agents.totalEarnings` and
  `agents.completedTasks` SQL `+` aggregation from double-counting on re-runs (reorgs,
  restarts, manual replays).
- **Protocol admin events** (`FeesUpdated`, `FeeRecipientUpdated`, `ForwarderUpdated`,
  `ReputationRegistryUpdated`) are now indexed into a new `protocol_events` audit log
  (migration 0016, `jsonb args` column) so every protocol-config change has a queryable
  history with full provenance — useful for surfacing operator activity in the UI and
  for after-the-fact debugging when a config change broke something downstream.
