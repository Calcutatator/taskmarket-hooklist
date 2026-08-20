// Implements: ADR-0099. Search is a predicate, not a second retrieval path.
//
// The point of this module is what it does *not* do: it never selects rows. It returns a SQL
// condition that the caller appends to the same condition list that already carries
// discoverability, expiry, unlisted-task and private-task rules. That is what makes it impossible
// for search to surface something browse hides -- not discipline, but the fact that there is only
// one query. A future change that builds a separate search query loses this property silently, so
// keep the shape.

import { sql, type SQL } from 'drizzle-orm';

import { submissions, tasks } from '../db/schema';
import { formatReferenceCode, normalizeReferenceCode } from './reference-codes';

/** 0x followed by 64 hex characters -- a bytes32 task id as emitted by TaskCreated. */
const TASK_ID_PATTERN = /^0x[0-9a-f]{64}$/i;
/** 0x followed by 40 hex characters -- an EVM address. */
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;

export type TaskSearchKind = 'reference-code' | 'task-id' | 'address' | 'full-text';

export type TaskSearchPlan = {
  kind: TaskSearchKind;
  condition: SQL;
  /**
   * True when the query resolved to a specific thing rather than a set of matches. Relevance
   * ordering is meaningless for these, so the caller keeps its normal sort.
   */
  exact: boolean;
};

/**
 * Build the condition for a free-text query.
 *
 * Exact identifiers short-circuit ahead of the ranked query: tokenizing `SUB-7K2QA9XF` as English
 * prose is both slower and worse than looking it up. Every branch is still only a condition, so a
 * code naming a task the caller may not see simply fails to match -- not-found and not-permitted
 * are indistinguishable without either being handled separately.
 */
export function buildTaskSearchPlan(rawQuery: string): TaskSearchPlan {
  const query = rawQuery.trim();

  const reference = normalizeReferenceCode(query);
  if (reference) {
    // A prefixless code could name either entity, so match both. This is not ambiguity-swallowing:
    // a task and a submission would have to have drawn the same eight characters for both to hit,
    // and the caller reports that case from the row count rather than guessing here.
    const taskCode =
      reference.entity === 'task'
        ? reference.code
        : reference.entity === null
          ? formatReferenceCode('task', reference.code)
          : null;
    const submissionCode =
      reference.entity === 'submission'
        ? reference.code
        : reference.entity === null
          ? formatReferenceCode('submission', reference.code)
          : null;

    const clauses: SQL[] = [];
    if (taskCode) {
      clauses.push(sql`${tasks.referenceCode} = ${taskCode}`);
    }
    if (submissionCode) {
      // A submission code names the task it belongs to: a submission is only ever shown in its
      // task's context, so that is the row a search should return.
      clauses.push(
        sql`exists (
          select 1 from ${submissions}
          where ${submissions.taskId} = ${tasks.id}
            and ${submissions.referenceCode} = ${submissionCode}
        )`
      );
    }

    return {
      condition: clauses.length === 1 ? clauses[0] : sql`(${clauses[0]} or ${clauses[1]})`,
      exact: true,
      kind: 'reference-code',
    };
  }

  if (TASK_ID_PATTERN.test(query)) {
    return {
      condition: sql`lower(${tasks.id}) = ${query.toLowerCase()}`,
      exact: true,
      kind: 'task-id',
    };
  }

  if (ADDRESS_PATTERN.test(query)) {
    const address = query.toLowerCase();
    return {
      condition: sql`(lower(${tasks.requester}) = ${address} or lower(${tasks.claimedBy}) = ${address})`,
      exact: true,
      kind: 'address',
    };
  }

  // websearch_to_tsquery rather than to_tsquery or plainto_tsquery: it supports the quoted-phrase
  // and -exclusion syntax people already expect from every other search box, and -- decisively --
  // it does not throw on malformed input. A hostile or nonsensical query returns no rows instead
  // of a 500.
  return {
    condition: sql`${tasks.searchVector} @@ websearch_to_tsquery('english', ${query})`,
    exact: false,
    kind: 'full-text',
  };
}

/**
 * Relevance ordering for a full-text query.
 *
 * `ts_rank_cd` over the weighted vector, so a hit in the title outranks one in the tags, which
 * outranks one in the body. Recency breaks ties, which keeps the order total and therefore stable
 * across pages.
 */
export function taskRelevanceOrder(rawQuery: string): SQL {
  return sql`ts_rank_cd(${tasks.searchVector}, websearch_to_tsquery('english', ${rawQuery})) desc, ${tasks.createdAt} desc`;
}
