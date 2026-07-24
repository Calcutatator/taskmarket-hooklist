import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { TASK_ACCESS_GRANT_HEADER } from '@taskmarket/shared';

// Phase 3 (ADR-0030): local cache of password-verified grants for private tasks,
// keyed by taskId (a session may plausibly unlock more than one private task). Same
// ~/.taskmarket/ directory as keystore.json, but its own file -- a grant is not wallet
// secret material and has nothing to do with the keystore's encrypted private key.
interface GrantRecord {
  grant: string;
  expiresAt: string;
}

function getGrantsPath(): string {
  return path.join(os.homedir(), '.taskmarket', 'task-access-grants.json');
}

async function readGrantsFile(): Promise<Record<string, GrantRecord>> {
  try {
    const raw = await fs.readFile(getGrantsPath(), 'utf-8');
    return JSON.parse(raw) as Record<string, GrantRecord>;
  } catch {
    return {};
  }
}

/** Returns the cached grant token for `taskId`, or null if absent or expired. */
export async function loadTaskAccessGrant(taskId: string): Promise<string | null> {
  const grants = await readGrantsFile();
  const record = grants[taskId];
  if (!record) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record.grant;
}

/** Builds the X-Taskmarket-Task-Access-Grant header for `taskId` if a valid grant is cached. */
export async function taskAccessGrantHeaders(taskId: string): Promise<Record<string, string>> {
  const grant = await loadTaskAccessGrant(taskId);
  return grant ? { [TASK_ACCESS_GRANT_HEADER]: grant } : {};
}

export async function saveTaskAccessGrant(
  taskId: string,
  grant: string,
  expiresAt: string
): Promise<void> {
  const grants = await readGrantsFile();
  grants[taskId] = { grant, expiresAt };
  const dir = path.dirname(getGrantsPath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getGrantsPath(), JSON.stringify(grants, null, 2), {
    mode: 0o600,
  });
}
