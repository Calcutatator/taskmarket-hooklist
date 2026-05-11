import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import morgan from 'morgan';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';
import { appRouter } from './router';
import { createContext } from './context';
import { logger, morganStream } from './lib/logger';
import { generateOpenAPI } from './lib/openapi';
import { getServerConfig } from './config/env';
import { x402Middleware } from './middleware/x402';
import { ogTagsMiddleware } from './middleware/ogTags';
import { emailInboundHandler } from './middleware/emailInbound';
import { db } from './db/client';
import { feedbacks } from './db/schema';
import { eq } from 'drizzle-orm';

export const app = express();

const config = getServerConfig();

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

if (config.NODE_ENV !== 'production') {
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
}

// Cloudflare Email Worker webhook — raw bytes, before bot-detection and JSON middleware
app.post(
  '/email/inbound',
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  emailInboundHandler
);

// OG meta tag middleware — bot requests are intercepted here before reaching API routes
app.use(ogTagsMiddleware);

// tRPC X402 guards
app.post(
  '/trpc/identity.register',
  x402Middleware({ getAmount: () => '1000', description: 'ERC-8004 agent identity registration' })
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

// X402 guards — mount BEFORE the OpenAPI handler
app.post(
  '/api/tasks',
  x402Middleware({ getAmount: (req) => String(req.body.reward), description: 'Create task' })
);
app.post(
  '/api/tasks/:taskId/accept',
  x402Middleware({ getAmount: () => '1000', description: 'Accept submission' })
);
app.post(
  '/api/tasks/:taskId/rate',
  x402Middleware({ getAmount: () => '1000', description: 'Rate task' })
);
app.post(
  '/api/tasks/:taskId/bids',
  x402Middleware({ getAmount: () => '1000', description: 'Submit bid' })
);
app.post(
  '/api/tasks/:taskId/bids/accept',
  x402Middleware({ getAmount: () => '1000', description: 'Auction accept' })
);
app.post(
  '/api/tasks/:taskId/cancel',
  x402Middleware({ getAmount: () => '1000', description: 'Cancel task' })
);
app.post(
  '/api/tasks/:taskId/update',
  x402Middleware({ getAmount: () => '1000', description: 'Update task' })
);
app.post(
  '/api/identity/register',
  x402Middleware({ getAmount: () => '1000', description: 'ERC-8004 agent identity registration' })
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

// skill.md — plain text agent integration guide (served from file, no restart needed to update)
app.get('/skill.md', (_, res) => {
  res.sendFile(path.resolve(process.cwd(), 'skill.md'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
});

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
