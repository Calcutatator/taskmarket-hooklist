import { z } from 'zod';
import { PositiveUsdcBaseUnitsSchema, UsdcBaseUnitsSchema } from './common.schemas';

export const BidCreateSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  price: PositiveUsdcBaseUnitsSchema,
});

export const AuctionAcceptSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  minPrice: UsdcBaseUnitsSchema.optional(),
});

export const BidResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string().nullable(),
  price: z.string().nullable(),
  createdAt: z.string(),
  workerAgentId: z.string().nullable().optional(),
  isMyBid: z.boolean().optional(),
});

export type BidCreate = z.infer<typeof BidCreateSchema>;
export type BidResponse = z.infer<typeof BidResponseSchema>;
export type AuctionAccept = z.infer<typeof AuctionAcceptSchema>;
