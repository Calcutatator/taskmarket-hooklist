import { z } from 'zod';

const EthAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
  .toLowerCase();
const EmailAddress = z.string().trim().toLowerCase().email().max(320);

export const TaskDropSourceSchema = z.enum([
  'first_run_panel',
  'agent_setup',
  'account',
  'cli',
  'drop_page',
  'taskdrop_landing',
  'official_drop_page',
]);

export const TaskDropSubscriptionScopeSchema = z.enum(['drop', 'official']);

export const TaskDropCreateInlineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});

export const TaskDropSubscribeInputSchema = z.object({
  taskDropId: z.string().min(1),
  email: EmailAddress,
  walletAddress: EthAddress.optional(),
  source: TaskDropSourceSchema.optional().default('drop_page'),
});

export const TaskDropSubscribeResponseSchema = z.object({
  subscribed: z.boolean(),
  alreadySubscribed: z.boolean(),
  email: EmailAddress,
  taskDropId: z.string(),
  scope: z.literal('drop'),
});

export const TaskDropOfficialSubscribeInputSchema = z.object({
  email: EmailAddress,
  walletAddress: EthAddress.optional(),
  source: TaskDropSourceSchema.optional().default('taskdrop_landing'),
});

export const TaskDropOfficialSubscribeResponseSchema = z.object({
  subscribed: z.boolean(),
  alreadySubscribed: z.boolean(),
  email: EmailAddress,
  scope: z.literal('official'),
});

export const TaskDropStatusInputSchema = z.object({
  taskDropId: z.string().min(1),
  email: EmailAddress,
});

export const TaskDropStatusResponseSchema = z.object({
  subscribed: z.boolean(),
  taskDropId: z.string(),
  scope: TaskDropSubscriptionScopeSchema.nullable(),
});

export const TaskDropOfficialStatusInputSchema = z.object({
  email: EmailAddress,
});

export const TaskDropOfficialStatusResponseSchema = z.object({
  subscribed: z.boolean(),
  scope: z.literal('official').nullable(),
});

export const TaskDropAnnouncementInputSchema = z.object({
  taskDropId: z.string().min(1),
});

export const TaskDropAnnouncementResponseSchema = z.object({
  taskDropId: z.string().min(1),
  announcedAt: z.string().datetime(),
  alreadyAnnounced: z.boolean(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const TaskDropListByOwnerInputSchema = z.object({
  ownerAddress: EthAddress,
});

export const TaskDropGetInputSchema = z.object({
  taskDropId: z.string().min(1),
});

export const TaskDropDirectoryInputSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(48).optional().default(24),
});

export const TaskDropSummarySchema = z
  .object({
    id: z.string().min(1),
    ownerAddress: EthAddress,
    officialWalletAddress: EthAddress,
    isOfficial: z.boolean(),
    name: z.string().min(1).max(80),
    description: z.string().max(500).nullable(),
    createdAt: z.string().datetime(),
    announcedAt: z.string().datetime().nullable(),
  })
  .refine((drop) => drop.officialWalletAddress === drop.ownerAddress, {
    message: 'officialWalletAddress must match ownerAddress',
    path: ['officialWalletAddress'],
  });

export const TaskDropTaskSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  reward: z.string().regex(/^\d+$/),
  status: z.string().min(1),
  mode: z.string().min(1),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  expiryTime: z.string().datetime(),
});

export const TaskDropPageDataSchema = z.object({
  drop: TaskDropSummarySchema,
  tasks: z.array(TaskDropTaskSchema),
});

export const TaskDropDirectoryItemSchema = z.object({
  drop: TaskDropSummarySchema,
  availableTaskCount: z.number().int().nonnegative(),
  taskCount: z.number().int().positive(),
  resolvedTaskCount: z.number().int().nonnegative(),
  totalReward: z.string().regex(/^\d+$/),
  nextExpiryTime: z.string().datetime().nullable(),
  latestTaskAt: z.string().datetime(),
});

export const TaskDropDirectoryResponseSchema = z.object({
  items: z.array(TaskDropDirectoryItemSchema),
  nextCursor: z.string().nullable(),
});

export type TaskDropSource = z.infer<typeof TaskDropSourceSchema>;
export type TaskDropSubscriptionScope = z.infer<typeof TaskDropSubscriptionScopeSchema>;
export type TaskDropCreateInline = z.infer<typeof TaskDropCreateInlineSchema>;
export type TaskDropSubscribeInput = z.infer<typeof TaskDropSubscribeInputSchema>;
export type TaskDropSubscribeResponse = z.infer<typeof TaskDropSubscribeResponseSchema>;
export type TaskDropOfficialSubscribeInput = z.infer<typeof TaskDropOfficialSubscribeInputSchema>;
export type TaskDropOfficialSubscribeResponse = z.infer<
  typeof TaskDropOfficialSubscribeResponseSchema
>;
export type TaskDropStatusInput = z.infer<typeof TaskDropStatusInputSchema>;
export type TaskDropStatusResponse = z.infer<typeof TaskDropStatusResponseSchema>;
export type TaskDropOfficialStatusInput = z.infer<typeof TaskDropOfficialStatusInputSchema>;
export type TaskDropOfficialStatusResponse = z.infer<typeof TaskDropOfficialStatusResponseSchema>;
export type TaskDropAnnouncementInput = z.infer<typeof TaskDropAnnouncementInputSchema>;
export type TaskDropAnnouncementResponse = z.infer<typeof TaskDropAnnouncementResponseSchema>;
export type TaskDropListByOwnerInput = z.infer<typeof TaskDropListByOwnerInputSchema>;
export type TaskDropGetInput = z.infer<typeof TaskDropGetInputSchema>;
export type TaskDropDirectoryInput = z.infer<typeof TaskDropDirectoryInputSchema>;
export type TaskDropSummary = z.infer<typeof TaskDropSummarySchema>;
export type TaskDropTask = z.infer<typeof TaskDropTaskSchema>;
export type TaskDropPageData = z.infer<typeof TaskDropPageDataSchema>;
export type TaskDropDirectoryItem = z.infer<typeof TaskDropDirectoryItemSchema>;
export type TaskDropDirectoryResponse = z.infer<typeof TaskDropDirectoryResponseSchema>;
