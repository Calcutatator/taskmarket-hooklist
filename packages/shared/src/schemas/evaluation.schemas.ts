import { z } from 'zod';
import { PositiveUsdcBaseUnitsSchema } from './common.schemas';

export const EvaluationAwardInputSchema = z.object({
  worker: z.string(),
  amount: PositiveUsdcBaseUnitsSchema,
  rank: z.number().int().min(1),
});

export const EvaluateInputSchema = z.object({
  taskId: z.string(),
  verdict: z.enum(['approve', 'reject', 'partial']),
  score: z.number().int().min(0).max(1000).optional().default(1000),
  confidence: z.number().int().min(0).max(1000).optional().default(1000),
  evidenceHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional()
    .default('0x0000000000000000000000000000000000000000000000000000000000000000'),
  awards: z.array(EvaluationAwardInputSchema).optional().default([]),
});

export const AppealInputSchema = z.object({ taskId: z.string() });

export const FinalizeVerdictInputSchema = z.object({ taskId: z.string() });

export const ResolveDisputeInputSchema = z.object({
  taskId: z.string(),
  verdict: z.enum(['approve', 'partial']),
  awards: z.array(EvaluationAwardInputSchema).min(1),
});

export const EvaluatorTimeoutInputSchema = z.object({ taskId: z.string() });

export type EvaluationAwardInput = z.infer<typeof EvaluationAwardInputSchema>;
export type EvaluateInput = z.infer<typeof EvaluateInputSchema>;
export type AppealInput = z.infer<typeof AppealInputSchema>;
export type FinalizeVerdictInput = z.infer<typeof FinalizeVerdictInputSchema>;
export type ResolveDisputeInput = z.infer<typeof ResolveDisputeInputSchema>;
export type EvaluatorTimeoutInput = z.infer<typeof EvaluatorTimeoutInputSchema>;
