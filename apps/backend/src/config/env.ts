import { z } from 'zod';

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

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    BASE_RPC_URL: z.string().url('BASE_RPC_URL must be a valid URL'),
    CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
    CONTRACT_DEPLOY_BLOCK: z.coerce.number().default(0),
    FORWARDER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid forwarder address'),
    USDC_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid USDC address'),
    DEFAULT_PLATFORM_FEE_BPS: z.coerce.number().min(0).max(10000).default(750),
    AWS_REGION: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_ENDPOINT_URL: z.string().url().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    CORS_ORIGIN: z.string().optional().default('*'),
    CHAIN_ID: z.coerce.number().default(8453),
    SERVER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    // Production/testnet: https://facilitator.daydreams.systems (works for Base Sepolia from localhost)
    // Local debugging only: http://localhost:8009
    X402_FACILITATOR_URL: z.string().url().default('https://facilitator.daydreams.systems'),
    X402_FACILITATOR_TOKEN: z.string().optional(),
    BACKEND_URL: z.string().url().default('http://localhost:3000'),
    ERC8004_IDENTITY_REGISTRY: z.string().default('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'),
    ERC8004_REPUTATION_REGISTRY: z.string().default('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'),
    ERC8004_SEED_BLOCK: z.coerce.number().default(0),
    // EIP-712 domain name for USDC. Mainnet Base USDC = 'USD Coin'; Sepolia USDC = 'USDC'
    USDC_DOMAIN_NAME: z.string().default('USD Coin'),
    PLATFORM_MASTER_KEY: z.string().min(32).default('0'.repeat(64)),
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
    DREAMS_HOOK_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    DREAMS_HOOK_SEED_BLOCK: z.coerce.number().default(0),
  })
  .superRefine((data, ctx) => {
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

      if (data.PLATFORM_MASTER_KEY === '0'.repeat(64)) {
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

export function getServerConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Environment validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}
