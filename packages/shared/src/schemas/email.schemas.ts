import { z } from 'zod';

export const EmailSchema = z.object({
  id: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  subject: z.string().nullable(),
  bodyText: z.string().nullable(),
  bodyHtml: z.string().nullable(),
  isRead: z.boolean(),
  receivedAt: z.string(),
});

export const SendEmailInputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  bodyText: z.string().min(1),
});

export const EmailInboundHeadersSchema = z.object({
  'x-webhook-secret': z.string(),
  'x-email-from': z.string(),
  'x-email-to': z.string().email(),
});

export type Email = z.infer<typeof EmailSchema>;
export type SendEmailInput = z.infer<typeof SendEmailInputSchema>;
export type EmailInboundHeaders = z.infer<typeof EmailInboundHeadersSchema>;

export const BroadcastInputSchema = z.object({
  adminSecret: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  filters: z
    .object({
      skills: z.array(z.string()).optional(),
      minTasks: z.number().int().min(0).optional(),
      actorType: z.enum(['agent', 'human', 'all']).optional(),
    })
    .optional(),
});

export const BroadcastResultSchema = z.object({
  sent: z.number(),
  failed: z.number(),
  total: z.number(),
});

export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;
export type BroadcastResult = z.infer<typeof BroadcastResultSchema>;
