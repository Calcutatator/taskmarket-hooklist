import { z } from 'zod';

const DiscordSnowflakeListSchema = z
  .string()
  .transform((value) => value.split(',').map((id) => id.trim()))
  .superRefine((ids, context) => {
    if (ids.length === 0 || ids.some((id) => !/^\d{1,20}$/.test(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Discord snowflake list' });
    }
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate Discord snowflake' });
    }
  });

const EnvironmentSchema = z
  .object({
    COMMIT_SHA: z.string().optional(),
    DEPLOY_ENVIRONMENT: z.string().default('development'),
    DISCORD_ALLOWED_CHANNEL_IDS: DiscordSnowflakeListSchema,
    DISCORD_ALLOWED_GUILD_IDS: DiscordSnowflakeListSchema,
    DISCORD_DOCS_URL: z.string().url().default('https://docs.taskmarket.dev'),
    DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
    DISCORD_STATUS_URL: z.string().url().optional(),
    DISCORD_SUPPORT_URL: z.string().url(),
    DISCORD_TASKMARKET_API_URL: z.string().url(),
    DISCORD_TASKMARKET_WEB_URL: z.string().url().default('https://taskmarket.dev'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3005),
  })
  .superRefine((config, context) => {
    if (config.DEPLOY_ENVIRONMENT === 'development' || config.DEPLOY_ENVIRONMENT === 'local') {
      return;
    }

    const urls = [
      ['DISCORD_DOCS_URL', config.DISCORD_DOCS_URL],
      ['DISCORD_STATUS_URL', config.DISCORD_STATUS_URL],
      ['DISCORD_SUPPORT_URL', config.DISCORD_SUPPORT_URL],
      ['DISCORD_TASKMARKET_API_URL', config.DISCORD_TASKMARKET_API_URL],
      ['DISCORD_TASKMARKET_WEB_URL', config.DISCORD_TASKMARKET_WEB_URL],
    ] as const;
    for (const [key, value] of urls) {
      if (value && new URL(value).protocol !== 'https:') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must use HTTPS outside local development`,
          path: [key],
        });
      }
    }
  });

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const config = EnvironmentSchema.parse(environment);
  return {
    allowedChannelIds: new Set(config.DISCORD_ALLOWED_CHANNEL_IDS),
    allowedGuildIds: new Set(config.DISCORD_ALLOWED_GUILD_IDS),
    commitSha: config.COMMIT_SHA ?? environment.RAILWAY_GIT_COMMIT_SHA ?? 'development',
    deployEnvironment: config.DEPLOY_ENVIRONMENT,
    discordPublicKey: config.DISCORD_PUBLIC_KEY,
    docsUrl: config.DISCORD_DOCS_URL,
    port: config.PORT,
    statusUrl: config.DISCORD_STATUS_URL,
    supportUrl: config.DISCORD_SUPPORT_URL,
    taskmarketApiUrl: config.DISCORD_TASKMARKET_API_URL,
    webUrl: config.DISCORD_TASKMARKET_WEB_URL,
  };
}
