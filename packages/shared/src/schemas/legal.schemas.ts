import { z } from 'zod';

export const LegalDocumentTypeSchema = z.enum([
  'terms_of_service',
  'privacy_policy',
  'risk_disclosure',
  'acceptable_use_policy',
]);

export const LegalDocumentSlugSchema = z.enum(['terms', 'privacy', 'risks', 'acceptable-use']);

export const LegalSha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const LegalBundleDocumentSchema = z.object({
  contentHash: LegalSha256DigestSchema,
  slug: LegalDocumentSlugSchema,
  summary: z.string(),
  title: z.string(),
  type: LegalDocumentTypeSchema,
  url: z.string().url(),
  version: z.string(),
});

export const LegalBundleSchema = z.object({
  acceptanceAvailable: z.boolean(),
  acceptanceStatement: z.string(),
  bundleDigest: LegalSha256DigestSchema,
  documents: z.array(LegalBundleDocumentSchema),
  effectiveAt: z.string().nullable(),
  enforcementEnabled: z.boolean(),
  privyAppId: z.string().nullable(),
  publishedAt: z.string(),
  status: z.enum(['draft', 'approved']),
  version: z.string(),
});

export const LegalSubjectTypeSchema = z.enum(['privy_user', 'wallet']);

export const LegalStatusResponseSchema = z.object({
  accepted: z.boolean(),
  bundle: LegalBundleSchema,
  receipt: z.string().optional(),
  subjectType: LegalSubjectTypeSchema.optional(),
});

const LegalWalletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const LegalAffirmationsSchema = z.object({
  acknowledgedRisk: z.literal(true),
  agreedToAcceptableUse: z.literal(true),
  agreedToTerms: z.literal(true),
  receivedPrivacyNotice: z.literal(true),
});

export const LegalChallengeInputSchema = z.object({
  walletAddress: LegalWalletAddressSchema,
});

export const LegalChallengeResponseSchema = z.object({
  bundle: LegalBundleSchema,
  expiresAt: z.string(),
  issuedAt: z.string(),
  message: z.string(),
  nonce: z.string().uuid(),
  walletAddress: LegalWalletAddressSchema,
});

const LegalAcceptanceBundleSchema = z.object({
  bundleDigest: LegalSha256DigestSchema,
  bundleVersion: z.string().max(128),
});

export const LegalWalletAcceptanceInputSchema = LegalAffirmationsSchema.merge(
  LegalAcceptanceBundleSchema
).extend({
  nonce: z.string().uuid(),
  signature: z.string().regex(/^0x[a-fA-F0-9]{128}(?:[a-fA-F0-9]{2})?$/),
  walletAddress: LegalWalletAddressSchema,
});

export const LegalWebAcceptanceInputSchema = LegalAffirmationsSchema.merge(
  LegalAcceptanceBundleSchema
);

export const LegalAcceptanceResponseSchema = z.object({
  acceptedAt: z.string(),
  bundleDigest: LegalSha256DigestSchema,
  bundleVersion: z.string(),
  receipt: z.string(),
});

export type LegalAcceptanceResponse = z.infer<typeof LegalAcceptanceResponseSchema>;
export type LegalBundle = z.infer<typeof LegalBundleSchema>;
export type LegalBundleDocument = z.infer<typeof LegalBundleDocumentSchema>;
export type LegalChallenge = z.infer<typeof LegalChallengeResponseSchema>;
export type LegalStatusResponse = z.infer<typeof LegalStatusResponseSchema>;
export type LegalSubjectType = z.infer<typeof LegalSubjectTypeSchema>;
export type LegalWalletAcceptanceInput = z.infer<typeof LegalWalletAcceptanceInputSchema>;
export type LegalWebAcceptanceInput = z.infer<typeof LegalWebAcceptanceInputSchema>;
