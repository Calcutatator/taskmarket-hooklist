import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { agents } from '../db/schema';
import type { db as DbType } from '../db/client';

type Db = typeof DbType;

export interface TargetAgentFilters {
  skills?: string[];
  minTasks?: number;
  actorType?: 'agent' | 'human' | 'all';
}

export interface TargetAgent {
  address: string;
  emailAddress: string;
}

/**
 * Select agents that should receive a fan-out notification (e.g. a broadcast or a
 * new-task alert). Only agents with a registered email address are returned, since
 * the delivery channel is email. Filters are additive:
 *   - skills: each provided skill must be present in the agent's skills array
 *   - minTasks: agent must have completed at least this many tasks
 *   - actorType: 'human' => registered via web, 'agent' => registered via cli,
 *     'all' (or undefined) => no actor-type constraint
 *
 * This is the shared recipient-targeting query used by the email broadcast and the
 * notify-on-create path so both stay in sync.
 */
export async function selectTargetAgents(
  db: Db,
  filters: TargetAgentFilters = {}
): Promise<TargetAgent[]> {
  const conditions: SQL[] = [isNotNull(agents.emailAddress)];

  if (filters.skills && filters.skills.length > 0) {
    for (const skill of filters.skills) {
      conditions.push(sql`${skill} = ANY(${agents.skills})`);
    }
  }
  if (filters.minTasks !== undefined) {
    conditions.push(gte(agents.completedTasks, filters.minTasks));
  }
  if (filters.actorType && filters.actorType !== 'all') {
    const channel = filters.actorType === 'human' ? 'web' : 'cli';
    conditions.push(eq(agents.registeredVia, channel));
  }

  const rows = await db
    .select({ address: agents.address, emailAddress: agents.emailAddress })
    .from(agents)
    .where(and(...conditions));

  // emailAddress is guaranteed non-null by the isNotNull condition above.
  return rows.map((r) => ({ address: r.address, emailAddress: r.emailAddress! }));
}
