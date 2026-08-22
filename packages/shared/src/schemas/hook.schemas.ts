import { z } from 'zod';

export const HookAddressSchema = z
  .string()
  .regex(/^0x(?!0{40}$)[a-fA-F0-9]{40}$/, 'Hook address must be a non-zero 20-byte hex address');
const HookTaskModeSchema = z.enum(['bounty', 'claim', 'pitch', 'benchmark', 'auction']);

export const HookIndexInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const HookGetInputSchema = z.object({
  address: HookAddressSchema,
});

export const HookIndexEntrySchema = z.object({
  address: HookAddressSchema,
  activePhaseTaskCount: z.number().int().nonnegative(),
  modes: z
    .array(HookTaskModeSchema)
    .max(5)
    .refine((modes) => new Set(modes).size === modes.length, 'Hook modes must be distinct'),
  taskCount: z.number().int().nonnegative(),
  taskIds: z.array(z.string()).max(8),
});

export const HookIndexResponseSchema = z.object({
  hooks: z.array(HookIndexEntrySchema).max(100),
  hasMore: z.boolean(),
  observation: z.literal('current-task-projection-one-effective-hook-per-task'),
});

export type HookIndexInput = z.infer<typeof HookIndexInputSchema>;
export type HookGetInput = z.infer<typeof HookGetInputSchema>;
export type HookIndexEntry = z.infer<typeof HookIndexEntrySchema>;
export type HookIndexResponse = z.infer<typeof HookIndexResponseSchema>;
