import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';
import { appRouter } from './router';
import { createContext } from './context';
import { morganStream } from './lib/logger';
import { generateOpenAPI } from './lib/openapi';
import { getServerConfig } from './config/env';
import { x402Middleware } from './middleware/x402';

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

// tRPC middleware (for frontend / existing clients)
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

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

// OpenAPI REST (handles all /api routes, including the ones above after X402 next())
app.use(
  '/api',
  createOpenApiExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// OpenAPI docs
const openApiDocument = generateOpenAPI();
app.get('/openapi.json', (_, res) => res.json(openApiDocument));

app.get('/docs', (_, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Clawtasker API Documentation</title>
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
