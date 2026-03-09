import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow && (
          <p className="text-xs font-mono uppercase tracking-[0.24em] text-text-tertiary">
            {eyebrow}
          </p>
        )}
        <div className="space-y-1.5">
          <h1 className="font-heading text-3xl font-bold leading-none tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description && <p className="max-w-3xl text-sm text-text-secondary">{description}</p>}
        </div>
      </div>

      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
