import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { validateCommunityBlueprintDirectory } from '../src/community/validate-blueprint';

const blueprintDirectory = resolve(import.meta.dirname, '../../../community/discord');

describe('Discord community blueprint validation', () => {
  it('accepts the checked-in provisionable blueprint', async () => {
    await expect(validateCommunityBlueprintDirectory(blueprintDirectory)).resolves.toBeUndefined();
  });

  it('rejects onboarding that cannot meet Discord Community defaults', async () => {
    const fixtureDirectory = await mkdtemp(resolve(tmpdir(), 'taskmarket-discord-blueprint-'));
    try {
      await cp(blueprintDirectory, fixtureDirectory, { recursive: true });
      const onboardingPath = resolve(fixtureDirectory, 'onboarding.yaml');
      const onboarding = parse(await readFile(onboardingPath, 'utf8')) as {
        entry: { default_channels: string[] };
      };
      onboarding.entry.default_channels = onboarding.entry.default_channels.slice(0, 6);
      await writeFile(onboardingPath, stringify(onboarding));

      await expect(validateCommunityBlueprintDirectory(fixtureDirectory)).rejects.toThrow(
        'at least seven default channels'
      );
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('rejects cross-file references to unknown channels', async () => {
    const fixtureDirectory = await mkdtemp(resolve(tmpdir(), 'taskmarket-discord-blueprint-'));
    try {
      await cp(blueprintDirectory, fixtureDirectory, { recursive: true });
      const onboardingPath = resolve(fixtureDirectory, 'onboarding.yaml');
      const onboarding = parse(await readFile(onboardingPath, 'utf8')) as {
        entry: { default_channels: string[] };
      };
      onboarding.entry.default_channels[0] = 'missing-channel';
      await writeFile(onboardingPath, stringify(onboarding));

      await expect(validateCommunityBlueprintDirectory(fixtureDirectory)).rejects.toThrow(
        'unknown values: missing-channel'
      );
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('rejects writable onboarding channels whose policy does not let everyone send', async () => {
    const fixtureDirectory = await mkdtemp(resolve(tmpdir(), 'taskmarket-discord-blueprint-'));
    try {
      await cp(blueprintDirectory, fixtureDirectory, { recursive: true });
      const rolesPath = resolve(fixtureDirectory, 'roles-and-permissions.yaml');
      const roles = parse(await readFile(rolesPath, 'utf8')) as {
        channel_policy: { posting: { members: { allow_everyone: string[] } } };
      };
      roles.channel_policy.posting.members.allow_everyone = ['add_reactions'];
      await writeFile(rolesPath, stringify(roles));

      await expect(validateCommunityBlueprintDirectory(fixtureDirectory)).rejects.toThrow(
        'must allow everyone to send messages'
      );
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('rejects a blueprint missing a launch-critical operational playbook', async () => {
    const fixtureDirectory = await mkdtemp(resolve(tmpdir(), 'taskmarket-discord-blueprint-'));
    try {
      await cp(blueprintDirectory, fixtureDirectory, { recursive: true });
      await rm(resolve(fixtureDirectory, 'playbooks/moderation-appeals.md'));

      await expect(validateCommunityBlueprintDirectory(fixtureDirectory)).rejects.toThrow(
        'missing playbooks/moderation-appeals.md'
      );
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });
});
