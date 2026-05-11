import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-28 w-full rounded-xl border border-input/78 bg-background/42 px-4 py-3 font-mono text-sm text-foreground shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] duration-300 ease-[var(--ease-premium)] placeholder:text-muted-foreground/82 focus-visible:border-ring focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
