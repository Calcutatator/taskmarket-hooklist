import { z } from 'zod';

const envSchema = z.object({
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
  CORS_ORIGIN: z.string().optional().default('*'),
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
