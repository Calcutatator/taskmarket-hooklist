import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { db } from './db/client';

export async function createContext({ req, res }: CreateExpressContextOptions) {
  return {
    db,
    req,
    res,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
