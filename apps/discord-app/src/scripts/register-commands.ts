import { z } from 'zod';
import { buildCommandManifest, COMMAND_NAMES } from '../commands/manifest';

const RegistrationEnvironmentSchema = z
  .object({
    DISCORD_APPLICATION_ID: z.string().min(1),
    DISCORD_APP_URL: z.string().url().optional(),
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_COMMAND_MODE: z.enum(['disabled', 'enabled']).default('enabled'),
    DISCORD_GUILD_ID: z.string().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.DISCORD_COMMAND_MODE === 'enabled' && !environment.DISCORD_APP_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DISCORD_APP_URL is required when commands are enabled',
        path: ['DISCORD_APP_URL'],
      });
    }
  });

const config = RegistrationEnvironmentSchema.parse(process.env);
let commands = [] as ReturnType<typeof buildCommandManifest>;
if (config.DISCORD_COMMAND_MODE === 'enabled') {
  const appUrl = config.DISCORD_APP_URL!;
  const healthResponse = await fetch(`${appUrl.replace(/\/$/, '')}/health`, {
    headers: { accept: 'application/json' },
  });
  if (!healthResponse.ok) {
    throw new Error(`Discord app health lookup failed with HTTP ${healthResponse.status}`);
  }
  const health = z
    .object({
      capabilities: z.object({
        commands: z.array(z.enum(COMMAND_NAMES)),
      }),
    })
    .parse(await healthResponse.json());
  commands = buildCommandManifest({
    includeStatus: health.capabilities.commands.includes('status'),
  });
  if (
    commands.some(
      (commandDefinition) => !health.capabilities.commands.includes(commandDefinition.name)
    )
  ) {
    throw new Error('Deployed Discord capabilities do not match this command manifest');
  }
}

const scope = config.DISCORD_GUILD_ID ? `/guilds/${config.DISCORD_GUILD_ID}` : '';
const response = await fetch(
  `https://discord.com/api/v10/applications/${config.DISCORD_APPLICATION_ID}${scope}/commands`,
  {
    body: JSON.stringify(commands),
    headers: {
      authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
    },
    method: 'PUT',
  }
);

if (!response.ok) {
  throw new Error(`Discord command registration failed with HTTP ${response.status}`);
}

const registered = z
  .array(z.object({ id: z.string(), name: z.string() }))
  .parse(await response.json());
process.stdout.write(
  `${config.DISCORD_COMMAND_MODE === 'disabled' ? 'Removed' : 'Registered'} ${registered.length} Discord commands\n`
);
