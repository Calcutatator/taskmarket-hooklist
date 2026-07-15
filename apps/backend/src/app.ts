import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import compression from 'compression';
import morgan from 'morgan';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';
import type { ZodTypeAny } from 'zod';
import { appRouter } from './router';
import { createContext } from './context';
import { logger, morganStream } from './lib/logger';
import { generateOpenAPI } from './lib/openapi';
import { getServerConfig } from './config/env';
import {
  IDENTITY_REGISTER_ROUTE,
  PAID_TASK_ACTION_ROUTES,
  STANDARD_X402_ACTION_AMOUNT,
  TASK_CREATE_ROUTE,
} from './config/payments';
import { CANONICAL_PREIMAGE_ROUTES } from './config/routes';
import {
  TaskCreateSchema,
  ProofSubmitSchema,
  PitchCreateSchema,
  PitchSelectSchema,
  UpdateTaskInputSchema,
  CancelTaskInputSchema,
  RefundExpiredInputSchema,
  RejectSubmissionInputSchema,
  BidCreateSchema,
  AuctionAcceptSchema,
  AppealInputSchema,
  EvaluateInputSchema,
  EvaluatorTimeoutInputSchema,
  ResolveDisputeInputSchema,
} from '@taskmarket/shared';
import {
  AcceptInputSchema,
  AcceptSubmissionsInputSchema,
  RateInputSchema,
} from './schemas/acceptance.schemas';
import { validateBody } from './middleware/validateBody';
import { X402PreflightError, x402Middleware, type X402Options } from './middleware/x402';
import { taskActionPreflight } from './middleware/taskActionPreflight';
import { getUpdatePaymentAmount } from './services/task-payments';
import { ogTagsMiddleware } from './middleware/ogTags';
import { emailInboundHandler } from './middleware/emailInbound';
import { createLegalAccessMiddleware } from './middleware/legal-access';
import { getCurrentLegalDocument } from './services/legal';
import { db } from './db/client';
import { feedbacks, submissions, artifacts, proposals, proofs, taskDrops } from './db/schema';
import { unsubscribeTaskDropsSubscription } from './services/task-drops-email';
import { and, eq } from 'drizzle-orm';
import {
  buildArtifactManifestJson,
  buildPitchPreimage,
  buildProofPreimage,
  type ArtifactManifestRow,
} from './lib/canonical-hashes';

export const app = express();

const config = getServerConfig();

if (config.TRUST_PROXY_HOPS > 0) {
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function renderTaskDropsUnsubscribePage(input: {
  action?: string;
  message: string;
  title: string;
}) {
  const action = input.action
    ? `<form method="post" action="${escapeHtml(input.action)}">
        <button type="submit">Unsubscribe</button>
      </form>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Task Drops unsubscribe</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        background: #0d0b0f;
        color: #f6f0f4;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: grid;
        place-items: center;
      }
      main {
        width: min(92vw, 520px);
        border: 1px solid #342631;
        border-radius: 8px;
        background: #171319;
        padding: 28px;
      }
      p {
        color: #b7aeb6;
        line-height: 1.6;
      }
      a {
        color: #d86586;
      }
      button {
        border: 0;
        border-radius: 6px;
        background: #d86586;
        color: #170b10;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 10px 16px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.message)}</p>
      ${action}
      <p><a href="${escapeHtml(config.WEB_APP_URL)}">Return to Taskmarket</a></p>
    </main>
  </body>
</html>`;
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })
);
app.use(compression());
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(morgan('combined', { stream: morganStream }));
app.use(express.json({ limit: '50mb' }));

app.get('/legal-documents/:version/:slug/:contentHash', (req, res) => {
  const document = getCurrentLegalDocument(
    req.params.version,
    req.params.slug,
    req.params.contentHash
  );
  if (!document) {
    res.status(404).type('text/plain').send('Legal document version not found.');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Taskmarket-Legal-Hash', document.contentHash);
  res.type('text/markdown').send(document.markdown);
});

if (config.NODE_ENV !== 'production') {
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
  // Target for LocalStorage.getPresignedUploadUrl — receives raw binary PUT from browser/CLI
  app.put('/uploads-local/:key(*)', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = path.resolve(uploadsDir, req.params.key);
    if (!filePath.startsWith(uploadsDir + path.sep)) {
      res.status(400).json({ error: 'Invalid key' });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body as Buffer);
    res.status(200).end();
  });
}

// Cloudflare Email Worker webhook — raw bytes, before bot-detection and JSON middleware
app.post(
  '/email/inbound',
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  emailInboundHandler
);

app.get('/task-drops/unsubscribe', (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!id || !token) {
    res
      .status(400)
      .type('html')
      .send(
        renderTaskDropsUnsubscribePage({
          message: 'This unsubscribe link is incomplete.',
          title: 'Unsubscribe link expired',
        })
      );
    return;
  }

  const query = new URLSearchParams({ id, token }).toString();
  res
    .status(200)
    .type('html')
    .send(
      renderTaskDropsUnsubscribePage({
        action: `/task-drops/unsubscribe?${query}`,
        message: 'Confirm that you want to stop receiving emails for this Task Drop.',
        title: 'Confirm unsubscribe',
      })
    );
});

app.post('/task-drops/unsubscribe', async (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  try {
    const result = await unsubscribeTaskDropsSubscription({ db, id, token });
    res
      .status(result.unsubscribed ? 200 : 400)
      .type('html')
      .send(
        renderTaskDropsUnsubscribePage({
          message: result.unsubscribed
            ? `${result.email} has been unsubscribed from Task Drops.`
            : 'We could not verify this unsubscribe link. It may have already been used or copied incorrectly.',
          title: result.unsubscribed ? 'Task Drops are off' : 'Unsubscribe link expired',
        })
      );
  } catch (err) {
    logger.error('Task Drops unsubscribe failed', { err });
    res
      .status(500)
      .type('html')
      .send(
        renderTaskDropsUnsubscribePage({
          message: 'Unable to unsubscribe right now. Please try again.',
          title: 'Unable to unsubscribe',
        })
      );
  }
});

// Legacy SPA OG middleware. The production Next app owns metadata and generated OG images.
if (process.env.SERVE_FRONTEND === 'true') {
  app.use(ogTagsMiddleware);
}

// Enforce versioned legal assent before any paid middleware can settle a payment.
// Public reads and designated exit/recovery routes are exempted inside the guard.
app.use(createLegalAccessMiddleware({ db }));

// tRPC X402 guards
app.post(
  '/trpc/identity.register',
  x402Middleware({
    getAmount: () => STANDARD_X402_ACTION_AMOUNT,
    description: 'ERC-8004 agent identity registration',
  })
);

// tRPC middleware (for frontend / existing clients)
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ path, error }) {
      logger.error(`tRPC error on /${path ?? 'unknown'}`, {
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
    },
  })
);

// Feedback file endpoint — mount before OpenAPI to avoid route conflict
app.get('/api/feedback/:id', async (req, res) => {
  try {
    const result = await db
      .select({ fileContent: feedbacks.fileContent })
      .from(feedbacks)
      .where(eq(feedbacks.id, req.params.id))
      .limit(1);
    if (!result.length) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', 'application/json');
    res.send(result[0].fileContent);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Canonical content-hash preimages. The response body is the exact byte string
// that was hashed on-chain — `keccak256(responseBytes)` equals the stored hash.
// See docs/concepts/content-verification for the full verification flow.
app.get(CANONICAL_PREIMAGE_ROUTES.submissionManifest, async (req, res) => {
  try {
    const sub = await db
      .select({
        deliverableHash: submissions.deliverableHash,
        submitTxHash: submissions.submitTxHash,
      })
      .from(submissions)
      .where(
        and(eq(submissions.id, req.params.submissionId), eq(submissions.taskId, req.params.taskId))
      )
      .limit(1);
    if (!sub.length) return res.status(404).json({ error: 'Submission not found' });

    const rows = (await db
      .select()
      .from(artifacts)
      .where(
        eq(artifacts.submissionId, req.params.submissionId)
      )) as unknown as ArtifactManifestRow[];
    if (!rows.length) return res.status(404).json({ error: 'No artifacts for submission' });

    const manifestJson = buildArtifactManifestJson(rows);
    if (sub[0].deliverableHash) res.setHeader('X-Deliverable-Hash', sub[0].deliverableHash);
    if (sub[0].submitTxHash) res.setHeader('X-Submit-Tx-Hash', sub[0].submitTxHash);
    res.setHeader('X-Hash-Function', 'keccak256');
    res.setHeader('X-Preimage-Encoding', 'json-utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(manifestJson);
  } catch (err) {
    logger.error('manifest endpoint failed', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get(CANONICAL_PREIMAGE_ROUTES.pitchPreimage, async (req, res) => {
  try {
    const row = await db
      .select({
        workerAddress: proposals.workerAddress,
        pitchText: proposals.proposalText,
        pitchHash: proposals.pitchHash,
        submitTxHash: proposals.submitTxHash,
      })
      .from(proposals)
      .where(and(eq(proposals.id, req.params.pitchId), eq(proposals.taskId, req.params.taskId)))
      .limit(1);
    if (!row.length) return res.status(404).json({ error: 'Pitch not found' });
    if (!row[0].pitchHash) return res.status(409).json({ error: 'Pitch has no on-chain hash' });

    const preimage = buildPitchPreimage(
      req.params.taskId as `0x${string}`,
      row[0].workerAddress as `0x${string}`,
      row[0].pitchText
    );
    res.setHeader('X-Pitch-Hash', row[0].pitchHash);
    if (row[0].submitTxHash) res.setHeader('X-Submit-Tx-Hash', row[0].submitTxHash);
    res.setHeader('X-Hash-Function', 'keccak256');
    res.setHeader('X-Preimage-Encoding', 'abi-encoded-bytes');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(preimage);
  } catch (err) {
    logger.error('pitch preimage endpoint failed', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get(CANONICAL_PREIMAGE_ROUTES.proofPreimage, async (req, res) => {
  try {
    const row = await db
      .select({
        workerAddress: proofs.workerAddress,
        proofData: proofs.proofData,
        proofHash: proofs.proofHash,
        submitTxHash: proofs.submitTxHash,
      })
      .from(proofs)
      .where(and(eq(proofs.id, req.params.proofId), eq(proofs.taskId, req.params.taskId)))
      .limit(1);
    if (!row.length) return res.status(404).json({ error: 'Proof not found' });
    if (!row[0].proofHash) return res.status(409).json({ error: 'Proof has no on-chain hash' });

    const preimage = buildProofPreimage(
      req.params.taskId as `0x${string}`,
      row[0].workerAddress as `0x${string}`,
      row[0].proofData
    );
    res.setHeader('X-Proof-Hash', row[0].proofHash);
    if (row[0].submitTxHash) res.setHeader('X-Submit-Tx-Hash', row[0].submitTxHash);
    res.setHeader('X-Hash-Function', 'keccak256');
    res.setHeader('X-Preimage-Encoding', 'abi-encoded-bytes');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(preimage);
  } catch (err) {
    logger.error('proof preimage endpoint failed', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// X402 guards — mount BEFORE the OpenAPI handler
app.post(
  TASK_CREATE_ROUTE,
  validateBody(TaskCreateSchema),
  x402Middleware({
    getAmount: (req) => String(req.body.reward),
    description: 'Create task',
    preflight: async (req, payer) => {
      const taskDropId = req.body.taskDropId;
      if (!taskDropId) return;

      const rows = await db
        .select({ id: taskDrops.id, ownerAddress: taskDrops.ownerAddress })
        .from(taskDrops)
        .where(eq(taskDrops.id, taskDropId))
        .limit(1);
      const drop = rows[0];

      if (!drop) throw new X402PreflightError('Task drop not found', 404);
      if (drop.ownerAddress.toLowerCase() !== payer.toLowerCase()) {
        throw new X402PreflightError('Task drop is not owned by payer', 403);
      }
    },
  })
);

type PaidTaskAction = keyof typeof PAID_TASK_ACTION_ROUTES;
type PaidTaskRouteHandler = {
  schema: ZodTypeAny;
  description: string;
  getAmount?: X402Options['getAmount'];
};

const paidTaskRouteHandlers: Record<PaidTaskAction, PaidTaskRouteHandler> = {
  accept: { schema: AcceptInputSchema, description: 'Accept submission' },
  accept_submissions: {
    schema: AcceptSubmissionsInputSchema,
    description: 'Accept submissions',
  },
  appeal: { schema: AppealInputSchema, description: 'Appeal evaluator verdict' },
  auction_accept: { schema: AuctionAcceptSchema, description: 'Auction accept' },
  bid: { schema: BidCreateSchema, description: 'Submit bid' },
  cancel: { schema: CancelTaskInputSchema, description: 'Cancel task' },
  evaluate: { schema: EvaluateInputSchema, description: 'Submit evaluator verdict' },
  evaluator_timeout: {
    schema: EvaluatorTimeoutInputSchema,
    description: 'Trigger evaluator timeout',
  },
  pitch: { schema: PitchCreateSchema, description: 'Submit pitch' },
  rate: { schema: RateInputSchema, description: 'Rate task' },
  refund_expired: { schema: RefundExpiredInputSchema, description: 'Refund expired task' },
  reject_submission: {
    schema: RejectSubmissionInputSchema,
    description: 'Reject submission',
  },
  resolve_dispute: { schema: ResolveDisputeInputSchema, description: 'Resolve task dispute' },
  submit_proof: { schema: ProofSubmitSchema, description: 'Submit proof' },
  update: {
    schema: UpdateTaskInputSchema,
    description: 'Update task',
    getAmount: (req) =>
      getUpdatePaymentAmount(db, req.params.taskId, req.body.reward as string | undefined),
  },
};

for (const action of Object.keys(PAID_TASK_ACTION_ROUTES) as PaidTaskAction[]) {
  const handler = paidTaskRouteHandlers[action];
  app.post(
    PAID_TASK_ACTION_ROUTES[action],
    validateBody(handler.schema),
    x402Middleware({
      getAmount: handler.getAmount ?? (() => STANDARD_X402_ACTION_AMOUNT),
      description: handler.description,
      preflight: taskActionPreflight(action),
    })
  );
}

app.post(
  '/api/tasks/:taskId/pitches/select',
  validateBody(PitchSelectSchema),
  x402Middleware({ getAmount: () => STANDARD_X402_ACTION_AMOUNT, description: 'Select pitch' })
);
app.post(
  IDENTITY_REGISTER_ROUTE,
  x402Middleware({
    getAmount: () => STANDARD_X402_ACTION_AMOUNT,
    description: 'ERC-8004 agent identity registration',
  })
);

// OpenAPI REST (handles all /api routes, including the ones above after X402 next())
app.use(
  '/api',
  createOpenApiExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ path, error }: { path: string | undefined; error: Error }) {
      logger.error(`OpenAPI error on ${path ?? 'unknown'}`, {
        message: error.message,
        stack: error.stack,
      });
    },
  })
);

const skillTextHeaders = { 'Content-Type': 'text/plain; charset=utf-8' };

// skill.md — plain text agent integration guide (served from file, no restart needed to update)
app.get('/skill.md', (_, res) => {
  res.sendFile(path.resolve(process.cwd(), 'skill.md'), {
    headers: skillTextHeaders,
  });
});

for (const directory of ['modes', 'reference', 'examples']) {
  app.use(
    `/${directory}`,
    express.static(path.resolve(process.cwd(), directory), {
      setHeaders(res) {
        res.set(skillTextHeaders);
      },
    })
  );
}

// OpenAPI docs
const openApiDocument = generateOpenAPI();
app.get('/openapi.json', (_, res) => res.json(openApiDocument));

app.get('/docs', (_, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Taskmarket API Documentation</title>
      <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.9.0/swagger-ui.css"
            integrity="sha384-ZJ2d83jl4Lvr6GKYzXpvQUmu+8us6T5frIryNHoLuypLK61jUnnCWZWyyrnifLda"
            crossorigin="anonymous" />
      <style>
        .swagger-ui .topbar { display: none }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"
              integrity="sha384-yrdF3mlUytUBwQyEVFAdwuUKEC9Qqrf+IUCgFgho4O5O6irf77pMjv36FN4eTpQD"
              crossorigin="anonymous"></script>
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"
              integrity="sha384-azzkurII4f+bjmZvm3hWhj7JezshyXtwobwneRyWCCIksK61Xi0Ry3xA2am9/TWp"
              crossorigin="anonymous"></script>
      <script>
        window.onload = function() {
          SwaggerUIBundle({
            url: '/openapi.json',
            dom_id: '#swagger-ui',
            presets: [
              SwaggerUIBundle.presets.apis,
              SwaggerUIStandalonePreset
            ],
            layout: "StandaloneLayout"
          });
        };
      </script>
    </body>
    </html>
  `);
});

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

if (process.env.SERVE_FRONTEND === 'true') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(__dirname, '../../../apps/frontend/dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
