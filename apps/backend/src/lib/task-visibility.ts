import { ne, sql } from 'drizzle-orm';
import { tasks } from '../db/schema';

/**
 * Shared "exclude unlisted tasks" filter, reused by every query that respects
 * task visibility outside a caller's own inbox (browse/search, stats, SEO,
 * Task Drop broadcasts). Centralizing this one condition means a future
 * visibility-rule change (e.g. the RFC's planned `private` value) is a
 * one-place edit instead of a repo-wide find-and-replace across call sites.
 */
export const taskNotUnlisted = ne(tasks.taskVisibility, 'unlisted');

/** Same filter for raw `sql` template contexts (e.g. stats.ts's aggregate queries). */
export const taskNotUnlistedSql = sql`task_visibility != 'unlisted'`;
