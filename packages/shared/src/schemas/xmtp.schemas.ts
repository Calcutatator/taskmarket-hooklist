import { z } from 'zod';

const EthereumAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const XmtpPolicySchema = z.enum(['allow', 'deny', 'quarantine']);
export const XmtpPolicyModeSchema = z.enum(['allowlist', 'open']);

export const AgentMessageEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.string().min(1),
  requestId: z.string().uuid(),
  replyToRequestId: z.string().uuid().nullable().optional(),
  senderInboxId: z.string().min(1),
  senderAddress: EthereumAddressSchema,
  sentAt: z.string().datetime(),
  deadlineMs: z.number().int().positive().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const XmtpBootstrapInputSchema = z.object({
  deviceId: z.string().min(1),
  apiToken: z.string().min(1),
  inboxId: z.string().min(1),
  installationId: z.string().min(1),
  dbPath: z.string().min(1).optional(),
  clientVersion: z.string().min(1).optional(),
});

export const XmtpBootstrapOutputSchema = z.object({
  inboxId: z.string(),
  installationId: z.string(),
  policyMode: XmtpPolicyModeSchema,
});

export const XmtpStatusInputSchema = z.object({
  deviceId: z.string().min(1),
  apiToken: z.string().min(1),
});

export const XmtpStatusOutputSchema = z.object({
  inboxId: z.string().nullable(),
  enabled: z.boolean(),
  policyMode: XmtpPolicyModeSchema,
  lastSeenAt: z.string().datetime().nullable(),
  activeInstallations: z.array(
    z.object({
      installationId: z.string(),
      status: z.string(),
      lastSeenAt: z.string().datetime(),
    })
  ),
});

export const XmtpHeartbeatInputSchema = z.object({
  deviceId: z.string().min(1),
  apiToken: z.string().min(1),
  installationId: z.string().min(1),
});

export const XmtpHeartbeatOutputSchema = z.object({
  ok: z.literal(true),
});

export const XmtpPeerPolicyUpsertSchema = z.object({
  deviceId: z.string().min(1),
  apiToken: z.string().min(1),
  peerInboxId: z.string().min(1),
  policy: XmtpPolicySchema,
  reason: z.string().min(1).optional(),
});

export const XmtpPeerPolicyListSchema = z.object({
  deviceId: z.string().min(1),
  apiToken: z.string().min(1),
});

export const XmtpPeerPolicyUpsertOutputSchema = z.object({
  ok: z.literal(true),
});

export const XmtpPeerPolicyListOutputSchema = z.object({
  policies: z.array(
    z.object({
      peerInboxId: z.string(),
      policy: XmtpPolicySchema,
      reason: z.string().nullable(),
      updatedAt: z.string().datetime(),
    })
  ),
});

export const XmtpResolvePeerInputSchema = z
  .object({
    address: EthereumAddressSchema.optional(),
    agentId: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.address || value.agentId), {
    message: 'Either address or agentId is required',
  });

export const XmtpResolvePeerOutputSchema = z.object({
  address: EthereumAddressSchema.nullable(),
  inboxId: z.string().nullable(),
});

export type AgentMessageEnvelope = z.infer<typeof AgentMessageEnvelopeSchema>;
export type XmtpPolicy = z.infer<typeof XmtpPolicySchema>;
export type XmtpPolicyMode = z.infer<typeof XmtpPolicyModeSchema>;
