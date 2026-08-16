# Slap-Chop Games operations

This runbook owns the first-release operations for `games.taskmarket.dev`. The Taskmarket release
owner deploys the application and backend together; the platform owner owns Railway, DNS, storage,
and Privy configuration. A curator owns catalog content. Do not weaken artifact eligibility,
integrity checks, iframe policy, or curator authorization to recover an incident.

## Production contract

- Railway project: `TASK MARKET`
- application service: `@taskmarket/slap-chop-games`
- application hostname: `games.taskmarket.dev`
- backend service: `@taskmarket/backend`
- release source: the `main` branch and the commit reported by `/api/health`
- application config path: `/apps/slap-chop-games/railway.json`

The application service needs these values in every deployed environment:

| Variable                      | Production value or source                           |
| ----------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`        | `https://games.taskmarket.dev`                       |
| `TASKMARKET_API_URL`          | the environment's Taskmarket backend origin          |
| `NEXT_PUBLIC_API_URL`         | the browser-reachable Taskmarket backend origin      |
| `NEXT_PUBLIC_PRIVY_APP_ID`    | the approved Taskmarket Privy application ID         |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | the approved public Privy client ID, when configured |
| `DEPLOY_ENVIRONMENT`          | `production`, `devnet`, or `preview`                 |
| `COMMIT_SHA`                  | the exact Git commit being deployed                  |

The backend additionally needs `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and a non-empty
`SLAP_CHOP_CURATOR_PRIVY_USER_IDS` allowlist before curation can be enabled. The public app ID must
match the server app ID. Missing or invalid identity configuration must leave voting unavailable
and curation fail closed.

The repository secret `RAILWAY_SLAP_CHOP_GAMES_SERVICE_NAME` must contain the exact production
Railway service name. `RAILWAY_SLAP_CHOP_GAMES_DEVNET_SERVICE_NAME` names the isolated DEVNET
service. Pull-request previews create a disposable `slap-chop-games-pr-<number>` service in their
ephemeral environment and remove it during fail-closed teardown.

## Release procedure

1. Confirm the migration journal on the current `main` tip is older than migrations `0049` and
   `0050`, then run the database-backed migration tests against a disposable database.
2. Run the repository checks through the Makefile, including the Slap-Chop unit, build, Storybook,
   and Playwright gates and the shared HTML sandbox tests.
3. Deploy a pull-request preview. The workflow bootstraps the dedicated service, resolves its
   preview and backend origins, rebuilds with its canonical site URL, adds that URL to the
   pull-request comment, and blocks until `/api/health` reports the expected commit and `preview`
   environment. The bootstrap build carries a non-final commit marker, so it cannot satisfy that
   check. Exercise browse, search, play, Back, voting, and curation only after that exact-release
   check.
4. Merge only after required checks and preview review are green. Let the production workflow
   deploy the backend first and Slap-Chop second.
5. The production workflow blocks until both the application and backend health endpoints report
   the merged commit. Independently read `https://games.taskmarket.dev/api/health` and the
   production backend health endpoint before the release is considered live.
6. Run the deployed security probe. It must show that a game cannot navigate its frame or emit
   image, fetch, form, popup, or nested-document requests to the probe sink.

## Seed procedure

Use the real `/curate` workspace; direct database inserts are not release evidence.

1. Resolve a Taskmarket task by canonical URL or ID.
2. Select only its accepted submission's immutable HTML artifact.
3. Preview under the production sandbox policy. Reject the game if the preview is ineligible,
   fails integrity, requests a policy exception, or does not play correctly on phone and desktop.
4. Supply concise metadata and a square cover. Confirm the stored source IDs, MIME type, byte size,
   SHA-256, and Keccak-256 match the resolved artifact.
5. Save a draft, review it again, and publish it with the explicit confirmation control.
6. Open the public catalog entry and confirm visible provenance, cover delivery, game startup, and
   catalog return behavior.

Keep the initial catalog deliberately small. Record each seed game's task, submission, artifact,
hashes, curator preview result, and public slug in the release issue without copying game bytes.

## Operational signals

Search structured backend logs by the `slap_chop.*` event family. The expected categories are:

- `slap_chop.http` for a bounded route, method, status-family, and duration record that replaces
  the generic raw access log for Slap-Chop endpoints;
- `slap_chop.catalog_read` for catalog and detail reads;
- `slap_chop.artifact_delivery_failure` for cover or game URL minting failures;
- `slap_chop.vote` and `slap_chop.vote_failure` for successful and rejected vote mutations;
- `slap_chop.vote_state` and `slap_chop.vote_state_failure` for authenticated vote-state reads;
- `slap_chop.curation` and `slap_chop.curation_failure` for curator resolution and lifecycle
  actions.
- `slap_chop.player_failure` for best-effort client player failures. Its `playerEvent` is one of
  `artifact_refresh_failure`, `integrity_failure`, or `runtime_failure`; its `reason` is a fixed
  operational enum. The browser posts neither credentials nor a referrer with this signal.

Events use only bounded operational dimensions: event name, operation, outcome, reason, duration,
boolean request-shape flags, result or artifact counts, and ranking mode. They must not contain
game HTML, game IDs or slugs, search terms, storage URIs, presigned URLs, bearer tokens, email
addresses, Privy user IDs, or client IP addresses. The player telemetry endpoint accepts a maximum
256-byte JSON object with exactly its approved `event` and `reason` fields; invalid payloads are
discarded without logging. Reporting is fail-open, so an unavailable telemetry endpoint never
changes game startup, refresh, or recovery behavior.

Investigate these conditions immediately:

- catalog reads repeatedly fail or exceed the release latency budget;
- artifact delivery failures increase for published games;
- an integrity failure occurs for a pinned artifact;
- vote rate-limit storage is unavailable or authentication failures spike;
- curation failures occur during a publish or hide operation.

## Recovery and rollback

### Curator access

If the last curator loses access, a platform owner updates `SLAP_CHOP_CURATOR_PRIVY_USER_IDS` with a
verified replacement Privy user ID and redeploys the backend. Never accept a client-provided email,
wallet address, or unsigned identity claim. Confirm the former ID is removed, the replacement can
resolve a task, and an unlisted identity still receives a denial.

### Bad game

An allowlisted curator hides the game from `/curate`. Confirm it disappears from both catalog and
direct game reads while its curation audit history remains intact. Preserve the immutable Taskmarket
artifact; hiding is a catalog action, not deletion.

### Ranking

Set `SLAP_CHOP_RANKING_MODE=new` on the backend and redeploy to roll back discovery ordering without
rewriting votes. Restore `hot` only after the ranking incident is understood and fixed.

### Application release

Use the **Roll back Slap-Chop Games on Railway** workflow with a full 40-character commit SHA that
is reachable from `main` and has a successful main CI run. The workflow rebuilds the exact
application ref, restamps its commit, environment, API origin, and site origin configuration, and
waits until `/api/health` proves the running service is that ref. DEVNET bootstrap builds carry a
non-final commit marker until the canonical site URL is known. It never redeploys the backend or
rewrites catalog data.

Before starting an application-only rollback, confirm the selected app still supports the deployed
backend API and migrations. If it does not, plan a coordinated backend rollback separately; do not
blindly roll database migrations back. After recovery, verify both health endpoints, repeat the
catalog/player security smoke, and record the chosen SHA and compatibility decision in the release
issue. The custom domain remains attached to the dedicated service.

## Release budgets

The production-like Playwright suite enforces bounded loading and these deliberately conservative
launch budgets on the local production build:

- first visible catalog game within 2.5 seconds;
- the first eight eager square covers loaded or visibly failed within 2.5 seconds;
- a 48-item client search reflected within 300 milliseconds;
- player loading resolved within 1.5 seconds and verified player content ready within 3 seconds;
- catalog failures resolved within 2.5 seconds and player failures within 3 seconds, with an
  explicit failure state instead of an indefinite spinner.

Treat a regression as a failed release even if a retry eventually succeeds. Tighten the budgets
after production measurements establish a stable baseline; do not loosen them to hide failures.
