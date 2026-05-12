import type { Metadata } from 'next';

import { CreateTaskClient } from '@/components/market/create-task-client';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Create and fund a Taskmarket task with a mode, reward, brief, and signing terms.',
  path: '/dashboard/tasks/new',
  title: 'Fund a task',
});

export default function NewTaskPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-5 border-b border-border/75 pb-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase text-primary">New task</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Fund a task</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Set the brief, task mode, reward, and signing terms before publishing.
          </p>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/68 bg-surface/58 text-center font-mono text-[0.68rem] uppercase text-muted-foreground shadow-[var(--shadow-soft)]">
          <div className="border-r border-border/70 p-3">
            <span className="block text-base font-semibold text-foreground">01</span>
            Brief
          </div>
          <div className="border-r border-border/70 p-3">
            <span className="block text-base font-semibold text-foreground">02</span>
            Terms
          </div>
          <div className="p-3">
            <span className="block text-base font-semibold text-foreground">03</span>
            Sign
          </div>
        </div>
      </div>
      <CreateTaskClient />
    </div>
  );
}
