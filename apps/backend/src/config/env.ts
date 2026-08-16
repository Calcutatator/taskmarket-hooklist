import { z } from 'zod';
import { getCurrentLegalBundleActivationIssues } from '@taskmarket/shared';

// Shared with devices.router.ts's deriveDeviceEncryptionKey, which refuses to derive a
// device encryption key from this value regardless of NODE_ENV -- the superRefine check
// below only runs for NODE_ENV === 'production', so a self-hosted/staging deployment
// that never sets this would otherwise silently use a publicly-known key with no
// runtime failure at all.
export const DEFAULT_PLATFORM_MASTER_KEY = '0'.repeat(64);

const strictBooleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean());

const officialTaskDropOwnerAddresses = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const addresses = value
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean);
    const uniqueAddresses = [...new Set(addresses)];

    for (const address of uniqueAddresses) {
      if (!/^0x[a-f0-9]{40}$/.test(address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid official Task Drop owner address',
        });
      }
    }

    return uniqueAddresses;
  });

// Implements: ADR-0088. Privy IDs are deliberately preserved byte-for-byte after trimming:
// they are opaque, case-sensitive identities, not wallet addresses. An absent or blank value
// therefore produces an empty allowlist and no one can become a curator by default.
const slapChopCuratorPrivyUserIds = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const userIds = value
      .split(',')
      .map((userId) => userId.trim())
      .filter(Boolean);
    const uniqueUserIds = [...new Set(userIds)];

    for (const userId of uniqueUserIds) {
      if (!/^did:privy:[A-Za-z0-9_-]{1,255}$/.test(userId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid Slap-Chop curator Privy user ID',
        });
      }
    }

    return uniqueUserIds;
  });

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1, 'DATABASE_URL is required')
  .url('DATABASE_URL must be a valid URL')
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
    message: 'DATABASE_URL must use the postgres or postgresql protocol',
  });

const optionalDatabaseEnvironmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema.optional(),
});

// Same isolation rationale as optionalDatabaseEnvironmentSchema above: apps/backend/src/
// config/payments.ts's getFreeSubmissionAllowance() is called from request-handling code
// (submissionAllowanceGate.ts) on every metered submission and must stay unit-testable
// without a fully configured server environment. Routing it through the full
// getServerConfig() -- as an earlier version of this code did -- turned a lookup of one
// optional field into a hard process.exit(1) whenever ANY unrelated required env var was
// missing, which is exactly the failure this isolated schema exists to avoid.
const optionalSubmissionFreeAllowanceEnvironmentSchema = z.object({
  SUBMISSION_FREE_ALLOWANCE: z.coerce.number().int().positive().optional(),
});

// Same isolation rationale as optionalSubmissionFreeAllowanceEnvironmentSchema above.
// RFC-0006's own spec (docs/specs/submission-tier-2-hard-ceiling.md, "The constant") said no
// override was needed for HARD_SUBMISSION_CEILING -- that call still holds for production. The
// real need this override serves is test ergonomics: proving the exact ceiling boundary in a
// smoke test cheaply (a small override value, e.g. 7) instead of doing ~94 real paid X402
// round-trips to reach the real default of 100. See apps/backend/src/scripts/smoke-rate-limit.ts.
const optionalHardSubmissionCeilingEnvironmentSchema = z.object({
  HARD_SUBMISSION_CEILING: z.coerce.number().int().positive().optional(),
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // Stamped by the deploy so the running process can prove which build it is. Optional:
    // absent locally, and absent is reported as absent rather than as a placeholder, so an
    // unstamped process is never mistaken for a verified one. `RAILWAY_GIT_COMMIT_SHA` is the
    // fallback Railway injects when a service builds from a connected repo; this deploy uploads
    // source with `railway up`, so it is normally the explicit value that is set.
    COMMIT_SHA: z.string().optional(),
    RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: databaseUrlSchema,
    BASE_RPC_URL: z.string().url('BASE_RPC_URL must be a valid URL'),
    CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
    CONTRACT_DEPLOY_BLOCK: z.coerce.number().default(0),
    TASK_AWARDS_BACKFILL_FROM_BLOCK: z.coerce.number().int().nonnegative().optional(),
    TASK_AWARDS_BACKFILL_TO_BLOCK: z.coerce.number().int().nonnegative().optional(),
    TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT: strictBooleanFromEnv.default(false),
    FORWARDER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid forwarder address'),
    USDC_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid USDC address'),
    DEFAULT_PLATFORM_FEE_BPS: z.coerce.number().min(0).max(10000).default(750),
    // RFC-0006 Tier 1 (docs/rfc/0006-submission-spam-free-allowance-pricing.md): overrides
    // FREE_SUBMISSION_ALLOWANCE (apps/backend/src/config/payments.ts) when set. Exists so
    // smoke tests and other harnesses that legitimately submit many times to the same
    // (worker, task) as part of ordinary multi-submission coverage -- not spam -- don't
    // need to route through x402Post once they cross the small production default. Unset
    // in normal deployments.
    SUBMISSION_FREE_ALLOWANCE: z.coerce.number().int().positive().optional(),
    // RFC-0006 Tier 2 (docs/specs/submission-tier-2-hard-ceiling.md): overrides
    // HARD_SUBMISSION_CEILING (apps/backend/src/config/payments.ts) when set. Test-ergonomics
    // only -- see getHardSubmissionCeilingOverride below. Unset in normal deployments; the
    // production ceiling stays at the real default of 100.
    HARD_SUBMISSION_CEILING: z.coerce.number().int().positive().optional(),
    AWS_REGION: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_ENDPOINT_URL: z.string().url().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    CORS_ORIGIN: z.string().optional().default('*'),
    CHAIN_ID: z.coerce.number().default(8453),
    SERVER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    DEV_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
    REQUESTER_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
    WORKER_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
    EVALUATOR_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
    WORKER_B_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
    // Production/testnet: https://facilitator.daydreams.systems (works for Base Sepolia from localhost)
    // Local debugging only: http://localhost:8009
    X402_FACILITATOR_URL: z.string().url().default('https://facilitator.daydreams.systems'),
    X402_FACILITATOR_TOKEN: z.string().optional(),
    BACKEND_URL: z.string().url().default('http://localhost:3000'),
    WEB_APP_URL: z.string().url().default('http://localhost:3001'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    // Implements: ADR-0051 -- replacement gas escalation policy. The defaults are Base's:
    // CHAIN_ID defaults to 8453, where a 21,000-gas self-transfer is cheap even at 10x its
    // original fee, so an aggressive posture costs almost nothing and a stalled shared nonce
    // costs every paid write on the platform. An Ethereum mainnet deployment should lower
    // REPLACEMENT_GAS_MAX_MULTIPLE and probably set REPLACEMENT_GAS_MAX_FEE_WEI.
    //
    // There is deliberately no cross-field boot check here. The cap scales the original
    // transaction's fee while the opening bid scales the live oracle, so the two have no
    // shared base and a boot-time comparison would pass on every sensible configuration while
    // implying a guarantee it never made. That check is made per transaction instead, in
    // lib/replacement-gas.ts.
    //
    // Opening bid as a percentage of the live oracle. 200 reproduces the previous flat 2x.
    REPLACEMENT_GAS_FIRST_BUMP_PCT: z.coerce.number().int().min(110).default(200),
    // Each attempt as a percentage of the previous attempt's fee. min(125) is load-bearing:
    // providers reject a replacement that does not raise the fee by roughly 10%, and 25%
    // clears that with room for bigint rounding and for a stricter provider.
    REPLACEMENT_GAS_ESCALATION_PCT: z.coerce.number().int().min(125).default(150),
    // Ceiling, as a multiple of the original transaction's fee.
    REPLACEMENT_GAS_MAX_MULTIPLE: z.coerce.number().int().min(2).default(10),
    // Optional absolute per-gas ceiling. Unset by default because a wei value means nothing
    // without knowing the chain.
    //
    // Governs EVERY send, not only replacements (ADR-0076), despite the name -- on the
    // replacement path it applies after `REPLACEMENT_GAS_MAX_MULTIPLE`, and on a first send after
    // `GAS_MULTIPLIER`. The name is kept because renaming a configured environment variable
    // breaks every deployment that sets it, which is a real cost paid for an accurate name.
    //
    // It is absolute rather than a multiple of the fee oracle deliberately: the failure it
    // bounds is the oracle itself climbing, and a ceiling derived from a runaway signal runs
    // away with it.
    //
    // Parsed as a decimal string into bigint, not through z.coerce.number(). ADR-0051's own
    // table specified `int`, following the surrounding pattern, and that is wrong for this one
    // field: a per-gas ceiling in wei is exactly the quantity that exceeds Number.MAX_SAFE_INTEGER
    // (2^53-1, about 9.007e15 wei -- roughly 9,007 gwei). Above that, IEEE-754 silently rounds,
    // so an operator setting a ceiling during a fee spike could get a different number than they
    // typed with no error anywhere. Fine at Base's fee levels and wrong on a chain where it
    // matters, which is precisely when someone reaches for this field.
    //
    // Rejecting anything that is not digits also rules out the forms Number would have accepted
    // and quietly mangled -- exponent notation, hex, a decimal point, leading whitespace.
    //
    // Empty and whitespace-only are normalised to absent before any of that runs. `.optional()`
    // only covers a variable that is not in the environment at all, but leaving a key blank in
    // a `.env` file is the ordinary way an operator says "unset", and it arrives as `''` -- so
    // without this the digits-only rule rejects it and the process exits at boot over a field
    // nobody meant to configure. Only the empty case is forgiven: every non-empty value still
    // has to be digits, which is what keeps the correction above load-bearing.
    REPLACEMENT_GAS_MAX_FEE_WEI: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .regex(/^\d+$/, 'REPLACEMENT_GAS_MAX_FEE_WEI must be a whole number of wei, digits only')
        .transform((value) => BigInt(value))
        .refine((value) => value > 0n, 'REPLACEMENT_GAS_MAX_FEE_WEI must be greater than zero')
        .optional()
    ),
    ERC8004_IDENTITY_REGISTRY: z.string().default('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'),
    ERC8004_REPUTATION_REGISTRY: z.string().default('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'),
    ERC8004_SEED_BLOCK: z.coerce.number().default(0),
    // EIP-712 domain name for USDC. Mainnet Base USDC = 'USD Coin'; Sepolia USDC = 'USDC'
    USDC_DOMAIN_NAME: z.string().default('USD Coin'),
    PLATFORM_MASTER_KEY: z.string().min(32).default(DEFAULT_PLATFORM_MASTER_KEY),
    XMTP_ENABLED: strictBooleanFromEnv.default(false),
    XMTP_POLICY_DEFAULT: z.enum(['allowlist', 'open']).default('open'),
    XMTP_STALE_INSTALLATION_MINUTES: z.coerce.number().positive().default(60),
    // Email
    EMAIL_DOMAIN: z.string().default('taskmarket.dev'),
    EMAIL_WEBHOOK_SECRET: z.string().min(32).optional(),
    OUTBOUND_EMAIL_WORKER_URL: z.string().url().optional(),
    SMTP_PORT: z.coerce.number().default(25),
    SMTP_TLS_CERT: z.string().optional(),
    SMTP_TLS_KEY: z.string().optional(),
    ADMIN_SECRET: z.string().min(16).optional(),
    OFFICIAL_TASK_DROP_OWNER_ADDRESSES: officialTaskDropOwnerAddresses,
    DREAMS_HOOK_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    DREAMS_HOOK_SEED_BLOCK: z.coerce.number().default(0),
    DREAMS_VAULT_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    DREAMS_VAULT_SEED_BLOCK: z.coerce.number().default(0),
    DREAMS_EPOCH_BUDGET_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    DREAMS_EPOCH_BUDGET_SEED_BLOCK: z.coerce.number().default(0),
    LEGAL_ENFORCEMENT_ENABLED: strictBooleanFromEnv.default(false),
    PRIVY_APP_ID: z.string().optional(),
    PRIVY_APP_SECRET: z.string().optional(),
    PRIVY_JWT_VERIFICATION_KEY: z.string().optional(),
    NEXT_PUBLIC_PRIVY_APP_ID: z.string().optional(),
    SLAP_CHOP_CURATOR_PRIVY_USER_IDS: slapChopCuratorPrivyUserIds,
    // Implements: ADR-0090. The only production rollback is newest-first; formula constants
    // stay in services/game-ranking.ts and are not configurable without a decision amendment.
    SLAP_CHOP_RANKING_MODE: z.enum(['hot', 'new']).default('hot'),
  })
  .superRefine((data, ctx) => {
    if (
      data.SLAP_CHOP_CURATOR_PRIVY_USER_IDS.length > 0 &&
      (!data.PRIVY_APP_ID || !data.PRIVY_APP_SECRET)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'PRIVY_APP_ID and PRIVY_APP_SECRET are required when Slap-Chop curators are configured',
        path: ['SLAP_CHOP_CURATOR_PRIVY_USER_IDS'],
      });
    }

    if (data.LEGAL_ENFORCEMENT_ENABLED) {
      const activationIssues = getCurrentLegalBundleActivationIssues();
      if (activationIssues.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `LEGAL_ENFORCEMENT_ENABLED requires final legal copy: ${activationIssues.join('; ')}`,
          path: ['LEGAL_ENFORCEMENT_ENABLED'],
        });
      }

      if (!data.PRIVY_APP_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'PRIVY_APP_ID is required when legal enforcement is enabled',
          path: ['PRIVY_APP_ID'],
        });
      }

      if (!data.PRIVY_APP_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'PRIVY_APP_SECRET is required when legal enforcement is enabled',
          path: ['PRIVY_APP_SECRET'],
        });
      }

      if (!data.NEXT_PUBLIC_PRIVY_APP_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NEXT_PUBLIC_PRIVY_APP_ID is required when legal enforcement is enabled',
          path: ['NEXT_PUBLIC_PRIVY_APP_ID'],
        });
      } else if (data.PRIVY_APP_ID && data.NEXT_PUBLIC_PRIVY_APP_ID !== data.PRIVY_APP_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'NEXT_PUBLIC_PRIVY_APP_ID must match PRIVY_APP_ID when legal enforcement is enabled',
          path: ['NEXT_PUBLIC_PRIVY_APP_ID'],
        });
      }
    }

    if (data.NODE_ENV === 'production') {
      const s3Vars = [
        'AWS_REGION',
        'AWS_S3_BUCKET',
        'AWS_ENDPOINT_URL',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
      ] as const;
      for (const key of s3Vars) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required in production`,
            path: [key],
          });
        }
      }

      if (new URL(data.BACKEND_URL).hostname === 'localhost') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'BACKEND_URL must not point to localhost in production',
          path: ['BACKEND_URL'],
        });
      }

      if (new URL(data.WEB_APP_URL).hostname === 'localhost') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WEB_APP_URL must not point to localhost in production',
          path: ['WEB_APP_URL'],
        });
      }

      if (data.PLATFORM_MASTER_KEY === DEFAULT_PLATFORM_MASTER_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'PLATFORM_MASTER_KEY must not be the default zero key in production',
          path: ['PLATFORM_MASTER_KEY'],
        });
      }

      if (!data.OUTBOUND_EMAIL_WORKER_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'OUTBOUND_EMAIL_WORKER_URL is required in production',
          path: ['OUTBOUND_EMAIL_WORKER_URL'],
        });
      }

      if (!data.ADMIN_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ADMIN_SECRET is required in production',
          path: ['ADMIN_SECRET'],
        });
      }

      if (!data.EMAIL_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EMAIL_WEBHOOK_SECRET is required in production',
          path: ['EMAIL_WEBHOOK_SECRET'],
        });
      }

      if (!data.X402_FACILITATOR_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'X402_FACILITATOR_TOKEN is required in production',
          path: ['X402_FACILITATOR_TOKEN'],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Returns the validated database URL for integration harnesses that need to
 * skip safely when PostgreSQL is not provisioned. Application code must use
 * getServerConfig() so the complete server environment is validated.
 */
export function getOptionalDatabaseUrl(): string | undefined {
  const result = optionalDatabaseEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid optional database configuration: ${result.error.message}`);
  }

  return result.data.DATABASE_URL;
}

/**
 * Returns the SUBMISSION_FREE_ALLOWANCE override in isolation -- see
 * optionalSubmissionFreeAllowanceEnvironmentSchema's rationale above. Application code
 * that needs the full server environment must still use getServerConfig().
 */
export function getSubmissionFreeAllowanceOverride(): number | undefined {
  const result = optionalSubmissionFreeAllowanceEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid SUBMISSION_FREE_ALLOWANCE: ${result.error.message}`);
  }

  return result.data.SUBMISSION_FREE_ALLOWANCE;
}

/**
 * Implements: ADR-0037
 * Returns the HARD_SUBMISSION_CEILING override in isolation -- see
 * optionalHardSubmissionCeilingEnvironmentSchema's rationale above. Application code
 * that needs the full server environment must still use getServerConfig(). The
 * production default (100, apps/backend/src/config/payments.ts) is unchanged when this
 * is unset; only smoke tests (and whoever explicitly sets the env var) get a different
 * value.
 */
export function getHardSubmissionCeilingOverride(): number | undefined {
  const result = optionalHardSubmissionCeilingEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid HARD_SUBMISSION_CEILING: ${result.error.message}`);
  }

  return result.data.HARD_SUBMISSION_CEILING;
}

export function getEvaluatorSmokePrivateKeys(): {
  evaluatorPrivateKey: `0x${string}`;
  resolverPrivateKey: `0x${string}`;
} {
  const config = getServerConfig();
  if (!config.EVALUATOR_PRIVATE_KEY || !config.WORKER_B_PRIVATE_KEY) {
    throw new Error(
      'EVALUATOR_PRIVATE_KEY and WORKER_B_PRIVATE_KEY are required for distinct-actor evaluator smoke coverage'
    );
  }
  return {
    evaluatorPrivateKey: config.EVALUATOR_PRIVATE_KEY as `0x${string}`,
    resolverPrivateKey: config.WORKER_B_PRIVATE_KEY as `0x${string}`,
  };
}

export function getServerConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Environment validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}
