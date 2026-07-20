import { TRPCError } from '@trpc/server';
import {
  LEGAL_RECEIPT_HEADER,
  LegalAcceptanceResponseSchema,
  LegalBundleSchema,
  LegalChallengeInputSchema,
  LegalChallengeResponseSchema,
  LegalStatusResponseSchema,
  LegalWalletAcceptanceInputSchema,
  LegalWebAcceptanceInputSchema,
} from '@taskmarket/shared';
import { z } from 'zod';

import { verifyPrivyAccessToken } from '../lib/privy-auth';
import {
  acceptWalletLegalTerms,
  assertLegalAcceptanceAvailable,
  createWalletLegalChallenge,
  getCurrentLegalBundle,
  getLegalAcceptanceForSubject,
  recordLegalAcceptance,
  reissueLegalReceipt,
  verifyLegalReceipt,
} from '../services/legal';
import { publicProcedure, router } from '../trpc';

function preventCredentialCaching(res: {
  setHeader(name: string, value: string): unknown;
  vary(field: string): unknown;
}): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  res.vary(LEGAL_RECEIPT_HEADER);
}

function requestEvidence(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}) {
  const userAgent = req.headers['user-agent'];
  return {
    ipAddress: req.ip,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
  };
}

function acceptanceError(error: unknown): TRPCError {
  const message = error instanceof Error ? error.message : 'Unable to record legal acceptance';
  const code = message.includes('awaiting counsel') ? 'PRECONDITION_FAILED' : 'BAD_REQUEST';
  return new TRPCError({ code, message });
}

async function verifiedPrivyClaim(authorization: string | undefined) {
  try {
    return await verifyPrivyAccessToken(authorization);
  } catch {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'A valid Privy access token is required',
    });
  }
}

export const legalRouter = router({
  current: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/legal/current',
        tags: ['Legal'],
        summary: 'Get the current versioned legal bundle',
      },
    })
    .input(z.object({}))
    .output(LegalBundleSchema)
    .query(() => getCurrentLegalBundle()),

  status: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/legal/status',
        tags: ['Legal'],
        summary: 'Check whether the current legal bundle has been accepted',
      },
    })
    .input(z.object({}))
    .output(LegalStatusResponseSchema)
    .query(async ({ ctx }) => {
      preventCredentialCaching(ctx.res);
      const bundle = getCurrentLegalBundle();
      const header = ctx.req.headers[LEGAL_RECEIPT_HEADER.toLowerCase()];
      const receipt = Array.isArray(header) ? header[0] : header;

      if (ctx.req.headers.authorization) {
        let claim;
        try {
          claim = await verifiedPrivyClaim(ctx.req.headers.authorization);
        } catch (error) {
          if (!bundle.enforcementEnabled) return { accepted: false, bundle };
          throw error;
        }
        if (receipt) {
          const identity = await verifyLegalReceipt(receipt);
          if (identity?.subjectType === 'privy_user' && identity.subjectId === claim.user_id) {
            return {
              accepted: true,
              bundle,
              subjectType: 'privy_user' as const,
            };
          }
        }

        const acceptance = await getLegalAcceptanceForSubject(ctx.db, 'privy_user', claim.user_id);
        if (acceptance) {
          return {
            accepted: true,
            bundle,
            receipt: await reissueLegalReceipt(ctx.db, acceptance),
            subjectType: 'privy_user' as const,
          };
        }

        return { accepted: false, bundle };
      }

      if (receipt) {
        const identity = await verifyLegalReceipt(receipt);
        const walletIdentity = identity?.subjectType === 'wallet' ? identity : null;
        return {
          accepted: Boolean(walletIdentity),
          bundle,
          ...(walletIdentity ? { subjectType: 'wallet' as const } : {}),
        };
      }

      return { accepted: false, bundle };
    }),

  challenge: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/legal/challenge',
        tags: ['Legal'],
        summary: 'Create a wallet-signature challenge for legal acceptance',
      },
    })
    .input(LegalChallengeInputSchema)
    .output(LegalChallengeResponseSchema)
    .mutation(async ({ input, ctx }) => {
      preventCredentialCaching(ctx.res);
      try {
        return await createWalletLegalChallenge(ctx.db, input.walletAddress);
      } catch (error) {
        throw acceptanceError(error);
      }
    }),

  acceptWallet: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/legal/accept/wallet',
        tags: ['Legal'],
        summary: 'Accept the current legal bundle with a wallet signature',
      },
    })
    .input(LegalWalletAcceptanceInputSchema)
    .output(LegalAcceptanceResponseSchema)
    .mutation(async ({ input, ctx }) => {
      preventCredentialCaching(ctx.res);
      try {
        const result = await acceptWalletLegalTerms(ctx.db, {
          ...requestEvidence(ctx.req),
          bundleDigest: input.bundleDigest,
          bundleVersion: input.bundleVersion,
          nonce: input.nonce,
          signature: input.signature as `0x${string}`,
          walletAddress: input.walletAddress,
        });
        return {
          acceptedAt: result.acceptance.acceptedAt.toISOString(),
          bundleDigest: result.acceptance.bundleDigest,
          bundleVersion: result.acceptance.bundleVersion,
          receipt: result.receipt,
        };
      } catch (error) {
        throw acceptanceError(error);
      }
    }),

  acceptWeb: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/legal/accept/web',
        tags: ['Legal'],
        summary: 'Accept the current legal bundle from an authenticated web session',
      },
    })
    .input(LegalWebAcceptanceInputSchema)
    .output(LegalAcceptanceResponseSchema)
    .mutation(async ({ input, ctx }) => {
      preventCredentialCaching(ctx.res);
      try {
        assertLegalAcceptanceAvailable(input.bundleVersion, input.bundleDigest);
        const claim = await verifiedPrivyClaim(ctx.req.headers.authorization);
        const result = await recordLegalAcceptance(ctx.db, {
          ...requestEvidence(ctx.req),
          acceptanceMethod: 'web_clickwrap',
          sessionId: claim.session_id,
          subjectId: claim.user_id,
          subjectType: 'privy_user',
        });
        return {
          acceptedAt: result.acceptance.acceptedAt.toISOString(),
          bundleDigest: result.acceptance.bundleDigest,
          bundleVersion: result.acceptance.bundleVersion,
          receipt: result.receipt,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw acceptanceError(error);
      }
    }),
});
