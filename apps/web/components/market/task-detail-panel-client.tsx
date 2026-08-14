'use client';

// Both public and authenticated task-detail routes must consume the panel through the same
// client boundary. Mixing a direct Server Component import with the caller-scoped client import
// leaves the production Turbopack module graph order-dependent across consecutive requests.
export { TaskDetailPanel } from '@/components/market/tasks';
export type { TaskModeData } from '@/components/market/tasks';
