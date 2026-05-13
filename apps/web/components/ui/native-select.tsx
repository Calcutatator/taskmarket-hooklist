import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function NativeSelect({
  className,
  children,
  wrapperClassName,
  ...props
}: React.ComponentProps<'select'> & { wrapperClassName?: string }) {
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          'h-10 w-full min-w-0 appearance-none rounded-full border border-input/78 bg-background/42 px-4 py-1 pr-9 font-mono text-sm text-foreground shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] duration-300 ease-[var(--ease-premium)] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/23',
          'focus-visible:border-ring focus-visible:bg-background/70 focus-visible:ring-[3px] focus-visible:ring-ring/35',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
