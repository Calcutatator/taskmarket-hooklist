import { ReactNode } from 'react';
import { Card, CardContent } from './card';
import { cn } from '@/lib/utils';

interface StatePanelProps {
  title: string;
  description?: string;
  children?: ReactNode;
  busy?: boolean;
  tone?: 'default' | 'error';
  className?: string;
}

export function StatePanel({
  title,
  description,
  children,
  busy = false,
  tone = 'default',
  className,
}: StatePanelProps) {
  return (
    <Card
      aria-busy={busy || undefined}
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'shadow-soft',
        tone === 'error'
          ? 'border-state-error-border bg-state-error-bg'
          : 'bg-background-secondary',
        className
      )}
    >
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center sm:py-12">
        <div className="space-y-2">
          <h2
            className={cn(
              'font-heading text-2xl font-bold',
              tone === 'error' ? 'text-state-error-text' : 'text-text-primary'
            )}
          >
            {title}
          </h2>
          {description && (
            <p
              className={cn(
                'max-w-2xl text-sm',
                tone === 'error' ? 'text-state-error-text' : 'text-text-secondary'
              )}
            >
              {description}
            </p>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
