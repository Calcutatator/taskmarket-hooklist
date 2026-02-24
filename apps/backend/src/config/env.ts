import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    BASE_RPC_URL: z.string().url('BASE_RPC_URL must be a valid URL'),
    CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
    CONTRACT_DEPLOY_BLOCK: z.coerce.number().default(0),
    USDC_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid USDC address'),
    DEFAULT_PLATFORM_FEE_BPS: z.coerce.number().min(0).max(10000).default(500),
    FEE_RECIPIENT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid fee recipient address'),
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
    ERC8004_IDENTITY_REGISTRY: z.string().default('0x8004A818BFB912233c491871b3d84c89A494BD9e'),
    ERC8004_REPUTATION_REGISTRY: z.string().default('0x8004B663056A597Dffe9eCcC1965A193B7388713'),
    PLATFORM_MASTER_KEY: z.string().min(32).default('0'.repeat(64)),
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
