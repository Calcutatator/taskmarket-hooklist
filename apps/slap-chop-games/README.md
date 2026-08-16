# Slap-Chop Games

`@taskmarket/slap-chop-games` is the separate public game-catalog app. It provides anonymous
catalog browsing, search, and fullscreen play for curator-pinned Taskmarket HTML artifacts. An
unlisted curator workspace manages catalog entries, and optional Privy identity enables reversible
votes without wallet connection, payment, or marketplace legal receipt.

## Local development

Use the repository Makefile from the monorepo root:

```sh
make start slap-chop-games
make build slap-chop-games
make lint-check slap-chop-games
make format-check slap-chop-games
make type-check slap-chop-games
make test slap-chop-games
make storybook slap-chop-games
```

The app uses port `3007` by default and Storybook uses port `6007`. Copy `.env.example` to
`.env.local` only when you need to override its validated defaults.

## Environment contract

`lib/environment.ts` validates the core deployment values at application configuration and request
time. The optional public Privy values are read only by the client-side vote identity boundary:

| Variable                      | Purpose                                           | Required                  |
| ----------------------------- | ------------------------------------------------- | ------------------------- |
| `NEXT_PUBLIC_SITE_URL`        | Canonical app URL used in metadata                | No, defaults to local URL |
| `TASKMARKET_API_URL`          | Private Taskmarket API origin for server rewrites | No                        |
| `NEXT_PUBLIC_API_URL`         | Public API-origin fallback                        | No                        |
| `NEXT_PUBLIC_PRIVY_APP_ID`    | Enables catalog-only Privy sign-in for votes      | No                        |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | Optional Privy client ID for that app             | No                        |
| `DEPLOY_ENVIRONMENT`          | `local`, `preview`, `devnet`, or `production`     | No, defaults to `local`   |
| `COMMIT_SHA`                  | Release identifier exposed by `/api/health`       | No                        |

Only `http` and `https` API origins are accepted. Without a Privy app ID, browsing and play remain
anonymous and vote controls are safely unavailable; configuring one loads only email, Google, and
passkey sign-in, with external and embedded wallet behavior disabled in the application.

## Railway delivery seam

Platform owners must create the dedicated Railway service, configure it to use the repository
root, and set its config-as-code path to `/apps/slap-chop-games/railway.json`. The config builds
from the monorepo root and starts this package, preserving workspace dependencies.

Set `RAILWAY_SLAP_CHOP_GAMES_SERVICE_NAME` in repository actions secrets after creating the
dedicated service. The testnet, preview, and production workflows then deploy it with the
environment's backend and site origins, and block until the application health response identifies
the expected commit. They fail if this prerequisite is missing. Provisioning the
`games.taskmarket.dev` domain remains a release milestone action.
