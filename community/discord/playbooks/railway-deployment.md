# Railway deployment

Owner: Engineering deploy owner. Backup: Security Lead. Review environment drift monthly and after
every rollback, command disablement, endpoint change, or credential rotation.

## One-time setup

Create two Discord applications, `Taskmarket DEVNET` and `Taskmarket`, and one Railway service
named by the `RAILWAY_DISCORD_SERVICE_NAME` GitHub secret. Configure the service to use
`apps/discord-app/railway.json` from the repository root.

Set separate Railway variables in DEVNET and PRODUCTION:

- `DISCORD_PUBLIC_KEY`
- `DISCORD_ALLOWED_GUILD_IDS`
- `DISCORD_ALLOWED_CHANNEL_IDS`
- `DISCORD_TASKMARKET_API_URL`
- `DISCORD_TASKMARKET_WEB_URL`
- `DISCORD_DOCS_URL`
- `DISCORD_SUPPORT_URL`
- optional `DISCORD_STATUS_URL`
- `DEPLOY_ENVIRONMENT`

The deployment workflows set `COMMIT_SHA` on the target service with `--skip-deploys` immediately
before uploading the matching source. CLI-source Railway deployments do not receive
`RAILWAY_GIT_COMMIT_SHA`; the explicit value is what `/health` publishes and what the post-deploy
smoke verifies. Do not edit `COMMIT_SHA` manually.

Set the Discord Interactions Endpoint URL to
`https://<railway-domain>/interactions`. Discord validates the signed PING before saving it.

Register DEVNET commands to a test guild by setting `DISCORD_APPLICATION_ID`,
`DISCORD_BOT_TOKEN`, and `DISCORD_GUILD_ID`, then run `make discord register`. For PRODUCTION,
omit `DISCORD_GUILD_ID` to register globally. The registration token is not needed by the running
service and must not be stored in its runtime variables.

`DISCORD_SUPPORT_URL` is deliberately required and has no application default. The Community and
Security owners must approve a private intake destination before launch; do not deploy a placeholder
URL.

## Promotion

Merges to `main` deploy to Railway DEVNET after CI succeeds. A production `v*` tag is eligible only
when the commit is reachable from `main`, passed the main-push CI workflow, and completed the
Discord DEVNET workflow. Create the tag only after invoking `/docs`, `/task`, `/tasks`, `/drop`,
`/task-drops`, and `/report` in an approved DEVNET channel. Deploy and rollback workflows share one
concurrency lock per environment. Each workflow stamps and uploads the exact commit, waits for
Railway to report terminal deployment success, verifies the commit and environment through
`/health`, exercises the exact checkout's
signed-request seam with generated fixture keys, then reconciles the target command manifest.
Discord alone holds the private key matching the deployed public key, so its endpoint validation is
the genuine remote signed PING; owners must repeat that validation after public-key or endpoint
changes.

The production tag workflow registers the new manifest only in the production canary guild. Staff
must exercise `/docs`, `/task`, `/tasks`, `/drop`, `/task-drops`, `/report`, and optional `/status`
in an approved canary channel, including an unlisted/private denial case and an
upstream-unavailable case. After the canary passes, an authorized operator runs `Publish Discord
production commands` with the immutable production SHA. That protected workflow re-verifies the
deployed commit before reconciling global
commands. Do not publish globally from the deployment workflow itself.

Configure Railway alerts for crash loops, failed health checks, and failed deployments. Route them
to the Engineering on-call destination, not a personal webhook. The service emits only command
class, result, and duration as structured operational events; alert on sustained rejected requests,
latency approaching Discord's response deadline, and health failures without collecting option
values or message bodies.

## Rollback

Use the protected rollback workflow with the immutable 40-character SHA of a commit that previously
deployed successfully to the affected environment. The workflow rejects mutable refs, commits off
`main`, and commits with no prior successful environment run. Do not switch Discord's endpoint to
DEVNET. Confirm `/health`, Discord endpoint validation, and the three live command canaries. If
privacy or signature verification is in doubt, remove the Interactions Endpoint URL until the
known-good deployment is restored.

For emergency command removal, run the protected `Emergency disable Discord commands` workflow,
select the affected environment, and enter the required confirmation. DEVNET guild commands are
replaced with an empty manifest. PRODUCTION clears both the canary-guild and global manifests.
This operation intentionally does not depend on application health. Restore commands only after
the incident commander approves a healthy immutable deployment and endpoint validation.
