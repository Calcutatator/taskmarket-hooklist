import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 font-mono text-[0.65rem] font-semibold whitespace-nowrap uppercase tracking-[0.08em] transition-[color,background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default:
          'border-primary/42 bg-primary/10 text-primary shadow-none [a&]:hover:bg-primary/14',
        secondary:
          'border-border/64 bg-secondary/54 text-secondary-foreground shadow-none [a&]:hover:bg-secondary/70',
        destructive:
          'border-destructive/46 bg-destructive/12 text-destructive shadow-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/16',
        outline:
          'border-border/64 bg-background/34 text-foreground shadow-none [a&]:hover:bg-accent/10 [a&]:hover:text-foreground',
        ghost: '[a&]:hover:bg-accent/15 [a&]:hover:text-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        terminal: 'border-border/64 bg-surface/52 text-foreground/84 shadow-none',
        success: 'border-success/46 bg-success/12 text-success shadow-none',
        warning: 'border-warning/46 bg-warning/12 text-warning shadow-none',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
