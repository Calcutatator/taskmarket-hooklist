// Implements: ADR-0098

import type { Metadata, Route } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { ApiConnectionError, fetchTasks } from '@/lib/api/server';

type ReferenceCodePageProps = {
  params: Promise<{ code: string }>;
};

export const metadata: Metadata = {
  // A resolver, not a destination: it only ever redirects, so there is nothing here worth
  // indexing and a crawler following one should land on the task instead.
  robots: { follow: true, index: false },
  title: 'Taskmarket reference code',
};

/**
 * Resolve a reference code to the thing it names.
 *
 * The lookup goes through the ordinary task listing with `?q=`, which already resolves both
 * `TSK-` and `SUB-` codes (ADR-0099). That is the whole point of having made search a predicate:
 * this route inherits the discoverability, unlisted and private-task rules without restating any
 * of them, and a code naming something the caller may not see simply finds nothing.
 *
 * So a code that does not exist and a code the viewer is not permitted to see produce the same
 * 404, and this route cannot be used to probe for hidden work.
 */
export default async function ReferenceCodePage({ params }: ReferenceCodePageProps) {
  const { code } = await params;
  const decoded = decodeURIComponent(code).trim();

  if (!decoded) {
    notFound();
  }

  let matches: Awaited<ReturnType<typeof fetchTasks>>;
  try {
    matches = await fetchTasks({ limit: 2, q: decoded, status: 'ALL' });
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      notFound();
    }
    throw error;
  }

  const task = matches.tasks[0];
  if (!task || matches.tasks.length > 1) {
    // More than one match means a prefixless code hit both a task and a submission. Redirecting
    // to an arbitrary one would send the viewer somewhere they did not ask for, so treat it as
    // unresolved rather than guessing.
    notFound();
  }

  const isSubmissionCode = decoded.toUpperCase().startsWith('SUB-');
  const target = isSubmissionCode
    ? `/tasks/${encodeURIComponent(task.id)}?submission=${encodeURIComponent(decoded.toUpperCase())}`
    : `/tasks/${encodeURIComponent(task.id)}`;

  // Permanent: a reference code is minted once and never reassigned, so the mapping from code to
  // task cannot change and a client is safe to cache it.
  permanentRedirect(target as Route);
}
