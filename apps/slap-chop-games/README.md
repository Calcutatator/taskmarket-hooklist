# Slap-Chop Games

`@taskmarket/slap-chop-games` is the separate public game-catalog app. It provides anonymous
catalog browsing, search, and fullscreen play for curator-pinned Taskmarket HTML artifacts. An
unlisted curator workspace manages catalog entries, and optional Privy identity enables reversible
votes without wallet connection, payment, or marketplace legal receipt.

## Local development

Use the repository Makefile from the monorepo root:

```sh
make start slap-chop-games-local
make start slap-chop-games-live
make start slap-chop-games
make build slap-chop-games
make lint-check slap-chop-games
make format-check slap-chop-games
make type-check slap-chop-games
make test slap-chop-games
make storybook slap-chop-games
make slap-chop pin https://taskmarket.dev/tasks/<task-id>
```

The app uses port `3007` by default and Storybook uses port `6007`. Copy `.env.example` to
`.env.local` only when you need to override its validated defaults.

`make start slap-chop-games-local` is the default product-development loop. It starts the app at
`http://localhost:3007` together with the deterministic fixture API used by Playwright. Its local
profile provides six small interactive games with distinct catalog metadata and covers, enough to
exercise the square grid, search, direct entry, verified HTML playback, Back restoration, and
responsive layouts without a database, chain, Privy configuration, or network dependency. The CI
profile retains the larger performance and hostile-sandbox fixture set. Override the ports with
`SLAP_CHOP_LOCAL_APP_PORT` and `SLAP_CHOP_LOCAL_API_PORT` when necessary.

The local command uses `.next-local` so a production build or Playwright run cannot leave a stale
route manifest in the development server's build directory.

This fixture mode is intentionally anonymous: vote controls remain unavailable and `/curate`
stays fail closed. Use `make storybook slap-chop-games` for authenticated vote and curator UI
states, and use the real local backend when verifying persistence or authorization behavior.

`make start slap-chop-games` remains the backend-connected mode and reads the API origin from the
environment contract below.

`make start slap-chop-games-live` is the production-content acceptance loop. It serves a small,
exact allowlist of accepted public Taskmarket games while keeping every vote and curation write off
production. The app resolves each task, accepted submission, artifact identity, size and both hashes
against `https://api.taskmarket.dev`, then proxies only that pinned artifact through the app origin.
The proxy enforces the shared 5 MB limit and SHA-256 pin before the browser performs its own second
integrity check and opens the game in the normal sandbox. It is not a general task or URL proxy.

Live-readonly mode is intentionally separate from deterministic fixtures. Use fixtures for CI and
interaction regression coverage, live-readonly for production-content and sandbox acceptance, and
the environment backend for persistence, voting and curator authorization work.

To propose another production game for DEVNET, run `make slap-chop pin <task-url-or-id>`. The
command accepts only a raw task ID or canonical `https://taskmarket.dev/tasks/{id}` URL. It resolves
the completed public task and its primary award, requires an exact non-rejected submission from the
awarded worker, selects one eligible final or preview HTML artifact, downloads it from a fresh HTTPS
delivery URL, and verifies its byte length and SHA-256 before printing a `LIVE_GAME_PINS` candidate.
It never prints the signed storage URL and never edits the catalog.

Review and play the candidate before copying it into `lib/live-catalog.ts`, add the generated square
cover path under `public/live-catalog/`, and replace the description and cover-alt placeholders. If
a submission contains multiple eligible HTML artifacts, select the reviewed one explicitly:

```sh
SLAP_CHOP_PIN_ARTIFACT_ID=<artifact-id> make slap-chop pin <task-url-or-id>
```

Workers commonly submit revisions. When the awarded worker has multiple non-rejected submissions,
the command lists their IDs and fails closed until the curator selects the reviewed revision:

```sh
SLAP_CHOP_PIN_SUBMISSION_ID=<submission-id> make slap-chop pin <task-url-or-id>
```

The selector cannot choose another worker's submission or a rejected submission. Both selectors can
be supplied together when the chosen submission also has multiple eligible HTML artifacts.

## Environment contract

`lib/environment.ts` validates the core deployment values at application configuration and request
time. The optional public Privy values are read only by the client-side vote identity boundary:

| Variable                        | Purpose                                           | Required                  |
| ------------------------------- | ------------------------------------------------- | ------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Canonical app URL used in metadata                | No, defaults to local URL |
| `TASKMARKET_API_URL`            | Private Taskmarket API origin for server rewrites | No                        |
| `NEXT_PUBLIC_API_URL`           | Public API-origin fallback                        | No                        |
| `NEXT_PUBLIC_PRIVY_APP_ID`      | Enables catalog-only Privy sign-in for votes      | No                        |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID`   | Optional Privy client ID for that app             | No                        |
| `DEPLOY_ENVIRONMENT`            | `local`, `preview`, `devnet`, or `production`     | No, defaults to `local`   |
| `SLAP_CHOP_DATA_MODE`           | `environment` or fail-closed `live-readonly`      | No                        |
| `SLAP_CHOP_LIVE_SOURCE_API_URL` | Public production source for live-readonly mode   | In live-readonly mode     |
| `COMMIT_SHA`                    | Release identifier exposed by `/api/health`       | No                        |

Only `http` and `https` API origins are accepted. Without a Privy app ID, browsing and play remain
anonymous and vote controls are safely unavailable; configuring one loads only email, Google, and
passkey sign-in, with external and embedded wallet behavior disabled in the application.
Production refuses `live-readonly`: the production app must use its own catalog backend and
database. DEVNET uses live-readonly so product review exercises real accepted HTML without making
production catalog, vote, or curation writes.

## Railway delivery seam

Platform owners must create the dedicated Railway service, configure it to use the repository
root, and set its config-as-code path to `/apps/slap-chop-games/railway.json`. The config builds
from the monorepo root and starts this package, preserving workspace dependencies.

Set `RAILWAY_SLAP_CHOP_GAMES_SERVICE_NAME` in repository actions secrets after creating the
dedicated service. The testnet, preview, and production workflows then deploy it with the
environment's backend and site origins, and block until the application health response identifies
the expected commit. They fail if this prerequisite is missing. Provisioning the
`games.taskmarket.dev` domain remains a release milestone action.
