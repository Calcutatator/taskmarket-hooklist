import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';
import { createContext } from './context';
import { morganStream } from './lib/logger';
import { getServerConfig } from './config/env';

export const app = express();

const config = getServerConfig();

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(morgan('combined', { stream: morganStream }));
app.use(express.json({ limit: '50mb' }));

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});
