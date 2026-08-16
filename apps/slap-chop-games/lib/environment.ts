import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'must use the http or https scheme')
  .transform((value) => value.replace(/\/+$/, ''));

const optionalHttpUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  httpUrl.optional()
);

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
);

const environmentSchema = z
  .object({
    COMMIT_SHA: optionalNonEmptyString,
    DEPLOY_ENVIRONMENT: z.enum(['local', 'preview', 'devnet', 'production']).default('local'),
    NEXT_PUBLIC_API_URL: optionalHttpUrl,
    NEXT_PUBLIC_SITE_URL: httpUrl.default('http://localhost:3007'),
    SLAP_CHOP_DATA_MODE: z.enum(['environment', 'live-readonly']).default('environment'),
    SLAP_CHOP_LIVE_SOURCE_API_URL: optionalHttpUrl,
    TASKMARKET_API_URL: optionalHttpUrl,
  })
  .superRefine((environment, context) => {
    if (
      environment.SLAP_CHOP_DATA_MODE === 'live-readonly' &&
      !environment.SLAP_CHOP_LIVE_SOURCE_API_URL
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'is required when SLAP_CHOP_DATA_MODE is live-readonly',
        path: ['SLAP_CHOP_LIVE_SOURCE_API_URL'],
      });
    }

    if (
      environment.DEPLOY_ENVIRONMENT === 'production' &&
      environment.SLAP_CHOP_DATA_MODE === 'live-readonly'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cannot be live-readonly in production',
        path: ['SLAP_CHOP_DATA_MODE'],
      });
    }
  });

export type SlapChopEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  source: Record<string, string | undefined> = process.env
): SlapChopEnvironment {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Slap-Chop Games environment: ${details}`);
  }

  return parsed.data;
}

export function getEnvironment(): SlapChopEnvironment {
  return parseEnvironment();
}
