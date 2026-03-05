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

export type Email = z.infer<typeof EmailSchema>;
export type SendEmailInput = z.infer<typeof SendEmailInputSchema>;
