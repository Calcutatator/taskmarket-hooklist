import { z } from 'zod';

export const BidCreateSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  price: z.string().min(1, 'Price is required'),
});

export const BidResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string(),
  price: z.string(),
  createdAt: z.string(),
  workerAgentId: z.string().nullable().optional(),
});

export type BidCreate = z.infer<typeof BidCreateSchema>;
export type BidResponse = z.infer<typeof BidResponseSchema>;
