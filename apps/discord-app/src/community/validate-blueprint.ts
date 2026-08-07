import { access, readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { parseDocument } from 'yaml';

const requiredYamlFiles = [
  'apps-and-webhooks.yaml',
  'automod.yaml',
  'forum-tags.yaml',
  'onboarding.yaml',
  'roles-and-permissions.yaml',
  'server.yaml',
] as const;

const requiredMarkdownFiles = [
  'README.md',
  'audits/launch-checklist.md',
  'audits/permission-audit.md',
  'copy/canonical-links.md',
  'copy/forum-templates.md',
  'copy/report-a-problem.md',
  'copy/server-guide.md',
  'copy/start-here.md',
  'copy/support-guidelines.md',
  'playbooks/compromised-account.md',
  'playbooks/incident-communications.md',
  'playbooks/moderation.md',
  'playbooks/moderation-appeals.md',
  'playbooks/offboarding.md',
  'playbooks/raid-response.md',
  'playbooks/railway-deployment.md',
  'playbooks/scams-and-impersonation.md',
  'playbooks/sensitive-escalation.md',
  'playbooks/support-triage.md',
] as const;

const ChannelSchema = z.object({
  copy: z.string().optional(),
  name: z.string().min(1),
  onboarding_default: z.boolean().optional(),
  onboarding_writable: z.boolean().optional(),
  posting: z.string().min(1),
  purpose: z.string().min(1),
  type: z.enum(['announcement', 'forum', 'text']),
});

const ServerSchema = z.object({
  categories: z.array(
    z.object({
      channels: z.array(ChannelSchema).min(1),
      name: z.string().min(1),
      visibility: z.string().min(1),
    })
  ),
  retention_intent: z.object({
    canonical_records: z.string().min(1),
    public_channels: z.string().min(1),
    staff_channels: z.string().min(1),
  }),
});

const OnboardingSchema = z.object({
  entry: z.object({
    default_channels: z.array(z.string().min(1)),
    writable_default_channels: z.array(z.string().min(1)),
  }),
  questions: z.array(
    z.object({
      answers: z.array(
        z.object({
          channels: z.array(z.string().min(1)),
          role: z.string().min(1).optional(),
        })
      ),
    })
  ),
});

const RolesSchema = z.object({
  channel_policy: z.object({
    posting: z.record(
      z
        .object({
          allow_everyone: z.array(z.string()).optional(),
        })
        .passthrough()
    ),
    visibility: z.record(
      z
        .object({
          allow_everyone: z.array(z.string()).optional(),
        })
        .passthrough()
    ),
  }),
  roles: z.array(z.object({ name: z.string().min(1) }).passthrough()),
});

const ForumTagsSchema = z.object({
  forums: z.record(
    z.object({
      classification_tags: z.array(z.string().min(1)).min(1),
      lifecycle_tags: z.array(z.string().min(1)).min(1),
      moderated_tags: z.array(z.string().min(1)),
      require_tag: z.literal(true),
    })
  ),
});

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
  );
  return files.flat();
}

async function parseYamlFile(path: string): Promise<unknown> {
  const source = await readFile(path, 'utf8');
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`${path}: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  const value: unknown = document.toJS();
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    throw new Error(`${path}: YAML document must be a non-empty mapping`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function assertKnown(values: readonly string[], known: ReadonlySet<string>, label: string): void {
  const unknown = values.filter((value) => !known.has(value));
  if (unknown.length > 0)
    throw new Error(`${label} reference unknown values: ${unknown.join(', ')}`);
}

export async function validateCommunityBlueprintDirectory(directory: string): Promise<void> {
  const files = await listFiles(directory);
  const relativeFiles = new Set(files.map((path) => relative(directory, path)));
  for (const requiredFile of [...requiredYamlFiles, ...requiredMarkdownFiles]) {
    if (!relativeFiles.has(requiredFile))
      throw new Error(`Discord blueprint is missing ${requiredFile}`);
  }

  const yamlFiles = files.filter((path) => path.endsWith('.yaml'));
  const yamlDocuments = new Map<string, unknown>();
  for (const path of yamlFiles) {
    yamlDocuments.set(relative(directory, path), await parseYamlFile(path));
  }

  const server = ServerSchema.parse(yamlDocuments.get('server.yaml'));
  const onboarding = OnboardingSchema.parse(yamlDocuments.get('onboarding.yaml'));
  const roles = RolesSchema.parse(yamlDocuments.get('roles-and-permissions.yaml'));
  const forumTags = ForumTagsSchema.parse(yamlDocuments.get('forum-tags.yaml'));
  const channels = server.categories.flatMap((category) => category.channels);
  const channelNames = channels.map((channel) => channel.name);
  const roleNames = roles.roles.map((role) => role.name);
  assertUnique(channelNames, 'Discord channel names');
  assertUnique(roleNames, 'Discord role names');

  const knownChannels = new Set(channelNames);
  const knownRoles = new Set(roleNames);
  const defaultChannels = onboarding.entry.default_channels;
  const writableDefaults = onboarding.entry.writable_default_channels;
  if (defaultChannels.length < 7)
    throw new Error('Onboarding requires at least seven default channels');
  if (writableDefaults.length < 5) {
    throw new Error('Onboarding requires at least five writable default channels');
  }
  assertUnique(defaultChannels, 'Onboarding default channels');
  assertUnique(writableDefaults, 'Onboarding writable default channels');
  assertKnown(defaultChannels, knownChannels, 'Onboarding default channels');
  assertKnown(writableDefaults, new Set(defaultChannels), 'Onboarding writable default channels');

  const declaredDefaults = new Set(
    channels.filter((channel) => channel.onboarding_default).map((channel) => channel.name)
  );
  const declaredWritableDefaults = new Set(
    channels.filter((channel) => channel.onboarding_writable).map((channel) => channel.name)
  );
  assertKnown(defaultChannels, declaredDefaults, 'Onboarding default channels');
  assertKnown(writableDefaults, declaredWritableDefaults, 'Onboarding writable default channels');

  for (const writableChannelName of writableDefaults) {
    const category = server.categories.find((candidate) =>
      candidate.channels.some((channel) => channel.name === writableChannelName)
    );
    const channel = category?.channels.find((candidate) => candidate.name === writableChannelName);
    if (!category || !channel) continue;

    const visibilityPolicy = roles.channel_policy.visibility[category.visibility];
    if (!visibilityPolicy?.allow_everyone?.includes('view_channel')) {
      throw new Error(
        `Writable onboarding channel ${writableChannelName} must allow everyone to view the channel`
      );
    }
    const postingPolicy = roles.channel_policy.posting[channel.posting];
    if (!postingPolicy?.allow_everyone?.includes('send_messages')) {
      throw new Error(
        `Writable onboarding channel ${writableChannelName} must allow everyone to send messages`
      );
    }
  }

  for (const question of onboarding.questions) {
    for (const answer of question.answers) {
      assertKnown(answer.channels, knownChannels, 'Onboarding answer channels');
      if (answer.role) assertKnown([answer.role], knownRoles, 'Onboarding answer roles');
    }
  }

  const visibilityPolicies = new Set(Object.keys(roles.channel_policy.visibility));
  const postingPolicies = new Set(Object.keys(roles.channel_policy.posting));
  for (const category of server.categories) {
    assertKnown([category.visibility], visibilityPolicies, `Category ${category.name} visibility`);
    for (const channel of category.channels) {
      assertKnown([channel.posting], postingPolicies, `Channel ${channel.name} posting`);
      if (channel.copy) await access(resolve(directory, channel.copy));
    }
  }

  const forumNames = new Set(
    server.categories
      .filter((category) => category.visibility !== 'staff')
      .flatMap((category) => category.channels)
      .filter((channel) => channel.type === 'forum')
      .map((channel) => channel.name)
  );
  assertKnown(Object.keys(forumTags.forums), forumNames, 'Forum tag configurations');
  assertKnown([...forumNames], new Set(Object.keys(forumTags.forums)), 'Forum channels');
  for (const [forumName, tags] of Object.entries(forumTags.forums)) {
    const allTags = [...tags.classification_tags, ...tags.lifecycle_tags];
    assertUnique(allTags, `Forum ${forumName} tags`);
    assertKnown(tags.moderated_tags, new Set(allTags), `Forum ${forumName} moderated tags`);
  }
}
