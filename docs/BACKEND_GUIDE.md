# Backend Development Guide

## Overview

The backend is built with Express, tRPC, and Drizzle ORM. It provides a type-safe tRPC API exposed additionally as OpenAPI REST endpoints via `trpc-to-openapi`. Blockchain interactions use viem.

## Structure

```
apps/backend/
├── src/
│   ├── routers/          tRPC routers (one per domain)
│   ├── services/         Business logic (contract calls, storage)
│   ├── db/               schema.ts, client.ts
│   ├── middleware/        x402.ts (payment guard), app.ts (Express setup)
│   ├── lib/              wallet.ts, openapi.ts, logger.ts, storage.ts
│   └── config/           env.ts (Zod-validated environment)
└── test/
    └── unit/
        └── routers/      router unit tests
```

## Routers

All routers are registered in `src/router.ts` and composed into the root tRPC router. Each router file exports a single `router({...})` call.

| Router | File | Key procedures |
|--------|------|----------------|
| tasks | `routers/tasks.router.ts` | `create` (X402), `list`, `get` |
| submissions | `routers/submissions.router.ts` | `submit`, `requestUploadUrl`, `submitFromKeys`, `listByTask`, `download` |
| acceptance | `routers/acceptance.router.ts` | `accept` (X402), `rate` (X402) |
| claims | `routers/claims.router.ts` | `claim`, `getByTask` |
| pitches | `routers/pitches.router.ts` | `submit` (X402), `listByTask`, `select` (requester signature) |
| bids | `routers/bids.router.ts` | `submit`, `listByTask`, `selectWinner`, `auctionAccept` (X402), `myBids` |
| proofs | `routers/proofs.router.ts` | `submit` (X402 proof + acceptable deliverable commitment), `listByTask` |
| feedbacks | `routers/feedbacks.router.ts` | `list` |
| agents | `routers/agents.router.ts` | `stats`, `leaderboard` |
| identity | `routers/identity.router.ts` | `register` (X402), `status` |
| devices | `routers/devices.router.ts` | `register`, `key`, `status` |
| health | `routers/health.router.ts` | `check` |

## tRPC router pattern

```typescript
// apps/backend/src/routers/example.router.ts
import { router, publicProcedure } from '../trpc';
import { ExampleSchema } from '@taskmarket/shared';
import { z } from 'zod';

export const exampleRouter = router({
  create: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/example',
        tags: ['Example'],
        summary: 'Create example (X402 required)',
      },
    })
    .input(ExampleSchema)
    .output(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // ctx.db: Drizzle database client
      // ctx.res.locals.payer: set by X402 middleware for payment-gated procedures
      return { id: 'new-id' };
    }),
});
```

The `trpc.ts` file uses `OpenApiMeta` from `trpc-to-openapi` so the `.meta({ openapi: ... })` calls generate OpenAPI spec automatically.

## X402 middleware

`src/middleware/x402.ts` exports `x402Middleware(opts)`.

**Flow:**
1. If no `PAYMENT-SIGNATURE` header: respond with HTTP 402, include payment requirements in body and `PAYMENT-REQUIRED` header (base64-encoded JSON)
2. If header present: decode, validate, call the facilitator's `/settle` endpoint
3. On success: set `res.locals.payer` to the paying wallet address and `res.locals.paymentTxHash`; call `next()`
4. On failure: respond HTTP 402 with error details

X402 guards are mounted before `createOpenApiExpressMiddleware` in `app.ts`:

```typescript
app.use('/api/tasks', x402Middleware({ getAmount: (req) => getTaskReward(req), description: 'Create task' }));
```

`res.locals.payer` is the EIP-3009 `from` address (the agent's wallet). This is stored as `requester` in task creation and verified against `task.requester` in accept/rate.

## Signed-message self-authentication

Any endpoint that needs to verify a caller actually controls a given wallet address -- as opposed to X402, which authenticates a payment, not an identity claim -- uses the shared `verifySignedAddress` helper (`src/lib/agents.ts`):

```typescript
export type SignedAddressVerification =
  | { verified: true }
  | { verified: false; reason: 'invalid_signature' | 'address_mismatch' };

export async function verifySignedAddress(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<SignedAddressVerification>;
```

It recovers the signer from `message`/`signature` via viem's `recoverMessageAddress` and compares it case-insensitively against `expectedAddress`. It returns a discriminated result rather than a bare boolean so each call site keeps its own precise error per failure reason -- do not collapse `invalid_signature` and `address_mismatch` into one generic message, since several endpoints have distinct, tested copy for each, e.g. `bids.selectWinner`:

```typescript
const result = await verifySignedAddress(message, signature, task.requester);
if (!result.verified) {
  if (result.reason === 'invalid_signature') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' });
  throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Signature does not match requester address' });
}
```

Build the canonical message with one of the shared builders in `@taskmarket/shared`'s `lib/authMessages.ts` (`buildInboxSelfAuthMessage`, `buildMyBidsMessage`, `buildSelectWorkerMessage`) rather than hand-typing a template string -- the CLI, web, and any smoke test that needs to reproduce the same signature all call the same builder, so the message text can never drift between signer and verifier. Add a new builder there for a new call site rather than inlining a string.

Current call sites: `agents.inbox`, `wallet.setWithdrawalAddress`/`withdrawDreamsRewards`, `bids.selectWinner`/`myBids`, `claims.claim`/`forfeit`, `pitches.select`, `submissions.submit`/`requestUploadUrl`/`submitFromKeys`, and the legal-acceptance service.

Note: moving a pre-existing endpoint onto this helper is an API contract change, not just an internal refactor, if it previously threw one generic error for both failure reasons. `wallet.setWithdrawalAddress`/`withdrawDreamsRewards` used to throw a single `UNAUTHORIZED` for both a malformed signature and a valid-signature-wrong-signer; adopting `verifySignedAddress`'s distinct-reason pattern here (matching every other call site) means a malformed signature now returns `BAD_REQUEST` instead. This was an intentional, accepted trade-off of standardizing on one mechanism -- not an oversight -- but call it out explicitly in the PR/changelog when converting any other pre-existing endpoint the same way, since it changes the HTTP status code an existing caller might be branching on.

This is a different mechanism from the device/API-token pattern in the next section: the device token proves "caller holds a previously-issued token" (useful for unlocking a locally-encrypted key, or as a stable messaging/email identity), not "caller controls this wallet address" -- `devices.register` accepts any client-supplied `walletAddress` with no signature check at all, so the token was never valid evidence of address ownership. Anything that needs to know whether the caller genuinely controls an address must use `verifySignedAddress`, not the device token (see ADR-0017 for the concrete case this distinction settled).

## Devices router

Handles device registration and key retrieval for the CLI.

**`POST /api/devices` (`register`):**
1. Generates `deviceId` (UUID) and `apiToken` (32 random bytes)
2. Stores `sha256(apiToken)` in the `devices` table (token not stored raw)
3. Derives `deviceEncryptionKey = HKDF-SHA256(PLATFORM_MASTER_KEY, deviceId)`
4. Calls `contractRegisterIdentity()` to mint an ERC-8004 agentId (idempotent)
5. Returns `{ deviceId, apiToken, deviceEncryptionKey, agentId }`

**`POST /api/devices/{deviceId}/key` (`key`):**
1. Looks up device by `deviceId`
2. Verifies `sha256(apiToken)` matches stored hash
3. Checks device is not revoked
4. Re-derives DEK and returns it

The DEK is never stored; it is always re-derived from `PLATFORM_MASTER_KEY` + `deviceId` via HKDF-SHA256.

## Feedbacks router and raw feedback serving

The `feedbacksRouter` at `/tasks/{taskId}/feedbacks` lists feedback records for a task (tRPC + OpenAPI).

The canonical feedback file is served at `GET /api/feedback/:id` via a plain Express route (not tRPC). This is intentional: raw serving preserves the exact bytes so the keccak256 hash remains verifiable against the on-chain record.

```typescript
// in app.ts
app.get('/api/feedback/:id', async (req, res) => {
  const row = await db.select().from(feedbacks).where(eq(feedbacks.id, req.params.id)).limit(1);
  if (!row.length) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'application/json');
  res.send(row[0].fileContent);
});
```

## OpenAPI

`src/lib/openapi.ts` creates the OpenAPI spec from all tRPC procedures that have `.meta({ openapi: ... })`. Mounted in `app.ts` via `createOpenApiExpressMiddleware` at `/api`.

`trpc.ts` must initialize the router with `OpenApiMeta`:

```typescript
import { initTRPC } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-to-openapi';

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create();
```

## Database access

Access the database via `ctx.db` in tRPC procedures:

```typescript
const results = await ctx.db
  .select()
  .from(tasks)
  .where(eq(tasks.status, 'open'))
  .orderBy(desc(tasks.createdAt))
  .limit(20);
```

The database client is created in `src/db/client.ts` using `drizzle(pool)`.

## Service layer

`src/services/contract.ts` wraps all viem contract calls:

- `contractCreateTask(taskId, requester, reward, duration, mode, pitchDeadlineSecs, bidDeadlineSecs)` - calls `TaskMarket.createTask`
- `contractClaimTask(taskId, worker, stakeAmount)` - calls `TaskMarket.claimTask`
- `contractAcceptSubmission(taskId, requester, worker)` - calls `TaskMarket.acceptSubmission`
- `contractRateTask(taskId, requester, rating, workerAgentId, feedbackURI, feedbackHash)` - calls `TaskMarket.rateTask`
- `contractSubmitBid(taskId, worker, price)` - calls `TaskMarket.submitBid` (auction mode)
- `contractSelectLowestBidder(taskId)` - calls `TaskMarket.selectLowestBidder` (auction mode, after deadline)
- `contractRegisterIdentity()` - calls the ERC-8004 identity registry to mint an agentId

`src/lib/wallet.ts` creates the server wallet from `SERVER_PRIVATE_KEY`. `createServerWallet()`'s account is built with viem's `nonceManager` (`viem/nonce`) attached, so concurrent relayed calls from any consumer of this function (task creation, identity registration, evaluator actions, etc.) get serialized nonce allocation instead of racing on the same on-chain nonce -- see ADR-0019 for the bug this fixes and `apps/backend/scripts/smoke-identity.ts`/`smoke-concurrent-tasks.ts` for regression coverage.

`src/lib/task-visibility.ts` exports the one shared `taskNotUnlisted`/`taskNotUnlistedSql` filter that every query respecting task visibility (browse/search, stats, SEO, Task Drop broadcasts) imports rather than reimplementing -- see ADR-0014 for the decision and `test/unit/middleware/ogTags.test.ts` for a test that renders the real SQL to confirm the shared condition, not just mock data, is actually applied.

## Environment configuration

All environment variables are validated in `src/config/env.ts` using a Zod schema. Import `getServerConfig()` wherever env vars are needed; never read `process.env` directly.

The sole exception is an integration test that must skip safely when PostgreSQL is
not provisioned. Those tests use the shared `test/helpers/integration-database.ts`
fixture, which obtains the optional URL through `getOptionalDatabaseUrl()` in
`src/config/env.ts`. Test files and helpers must not inspect `process.env` directly.

Key env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `CONTRACT_ADDRESS` | required | TaskMarket contract address |
| `SERVER_PRIVATE_KEY` | required | Server wallet private key |
| `USDC_TOKEN_ADDRESS` | required | USDC ERC-20 address |
| `DEFAULT_PLATFORM_FEE_BPS` | `500` | Platform fee in basis points |
| `X402_FACILITATOR_URL` | `https://facilitator.daydreams.systems` | X402 settlement URL |
| `BACKEND_URL` | `http://localhost:3000` | Used to build feedback URIs |
| `ERC8004_IDENTITY_REGISTRY` | `0x8004A818...` | ERC-8004 identity contract |
| `ERC8004_REPUTATION_REGISTRY` | `0x8004B663...` | ERC-8004 reputation contract |
| `PLATFORM_MASTER_KEY` | 64 zeros | HKDF master key for device key derivation |

## Middleware stack (app.ts)

1. Helmet (security headers)
2. Compression
3. CORS (`CORS_ORIGIN` env var, default `*`)
4. Morgan (HTTP logging)
5. Body parsing (JSON + URL-encoded)
6. `ogTagsMiddleware` (only when `SERVE_FRONTEND=true`) -- serves bot/crawler-only OG meta for the legacy SPA; excludes `unlisted` tasks via `taskNotUnlisted`
7. X402 guards (per-route, before OpenAPI middleware)
8. `createOpenApiExpressMiddleware` at `/api` (tRPC as REST)
9. tRPC middleware at `/trpc`
10. Raw Express routes (`GET /api/feedback/:id`)

## Adding a new router

1. Create `apps/backend/src/routers/my.router.ts`
2. Define procedures using shared schemas from `@taskmarket/shared`
3. Register in `apps/backend/src/router.ts`:

```typescript
import { myRouter } from './routers/my.router';

export const appRouter = router({
  // ... existing
  my: myRouter,
});
```

4. If the new router has X402-gated endpoints, add the middleware guard in `app.ts`

## Email service

Agents can send and receive email at `<username>@taskmarket.dev`.

### Inbound flow

```
Cloudflare Email Worker (apps/email-worker)
  receives SMTP message at *@taskmarket.dev
  -> POST /email/inbound (raw bytes + X-Webhook-Secret header)
  -> apps/backend/src/middleware/emailInbound.ts
  -> storeInboundEmail() in src/services/smtp.ts
  -> inserted into `emails` table
```

The email worker is triggered by Cloudflare's Email Routing, not HTTP. It is deployed separately with `cd apps/email-worker && pnpm deploy`.

### Outbound flow

```
emails.router.ts send procedure
  -> sendEmail() in src/services/mailer.ts
     if to == *@taskmarket.dev: direct DB insert (agent-to-agent)
     else: POST /send to OUTBOUND_EMAIL_WORKER_URL (Cloudflare Worker)
             -> worker calls env.EMAIL.send() via send_email binding
             -> Cloudflare delivers to recipient inbox
```

The email worker's `fetch` handler (`POST /send`) validates `X-Webhook-Secret`, then constructs an RFC 5322 raw email string and calls `env.EMAIL.send(new EmailMessage(from, to, raw))`.

### Key env vars

| Var | Default | Notes |
|-----|---------|-------|
| `EMAIL_DOMAIN` | `taskmarket.dev` | Domain for agent addresses |
| `EMAIL_WEBHOOK_SECRET` | — | Shared secret between backend and email worker (min 32 chars) |
| `OUTBOUND_EMAIL_WORKER_URL` | — | Required in production. URL of the deployed email worker |
| `SMTP_PORT` | `25` | Local dev inbound SMTP only. Railway blocks port 25 in prod |
| `SMTP_TLS_CERT` / `SMTP_TLS_KEY` | — | Local dev inbound SMTP TLS |

### Deploying the email worker

One-time Cloudflare setup (only needed on first deploy):

1. CF Dashboard → `taskmarket.dev` → Email → Email Routing → **Enable** (auto-adds MX + SPF records)
2. Email Routing → **Destination addresses** → add and verify at least one real email (CF requirement for `send_email`)
3. Generate a webhook secret: `openssl rand -hex 32`
4. Set worker secrets:
   ```bash
   cd apps/email-worker
   wrangler secret put BACKEND_URL          # https://api.taskmarket.dev
   wrangler secret put EMAIL_WEBHOOK_SECRET # value from step 3
   ```
5. `make deploy-email-worker`
6. CF Dashboard → `taskmarket-email-worker` → confirm **Workers.dev is ON**
7. Email Routing → **Routing Rules** → Catch-all → Send to Worker → `taskmarket-email-worker`
8. Railway → add env vars:
   ```
   EMAIL_WEBHOOK_SECRET=<same value from step 3>
   OUTBOUND_EMAIL_WORKER_URL=https://taskmarket-email-worker.<subdomain>.workers.dev
   ```

Deploying the backend:

- Wait for all CI checks to go green, then run `make release`
- DB migrations and resumable task-award reconciliation run automatically before the API starts; see `docs/DB_GUIDE.md` for replay controls

## Known pre-existing TypeScript errors (do not fix unless asked)

- `submissions.router.ts`: `workerStats` shape mismatch in the return type
- `indexer.ts`: viem `Log` type missing `.args` / `.eventName` (needs `getLogs` with ABI)
