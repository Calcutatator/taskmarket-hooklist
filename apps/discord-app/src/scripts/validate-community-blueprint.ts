import { resolve } from 'node:path';
import { validateCommunityBlueprintDirectory } from '../community/validate-blueprint';

const blueprintDirectory = process.env.DISCORD_BLUEPRINT_DIRECTORY
  ? resolve(process.env.DISCORD_BLUEPRINT_DIRECTORY)
  : resolve(process.cwd(), '../../community/discord');

await validateCommunityBlueprintDirectory(blueprintDirectory);
process.stdout.write('Validated Discord community blueprint structure and cross-file references\n');
