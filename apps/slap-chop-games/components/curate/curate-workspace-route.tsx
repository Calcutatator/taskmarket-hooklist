'use client';

import { useMemo } from 'react';

import { CurationWorkspace } from '@/components/curate/curation-workspace';
import { useSlapChopPrivy } from '@/components/slap-chop-privy-provider';
import { createCurationApi } from '@/lib/curation-api';

// Implements: ADR-0088. The route consumes the shared Privy boundary only for a bearer token;
// the backend resolves the authoritative exact-user curator allowlist for every request.
export function CurateWorkspaceRoute() {
  const auth = useSlapChopPrivy();
  const api = useMemo(() => createCurationApi(), []);

  return <CurationWorkspace api={api} auth={auth} />;
}
