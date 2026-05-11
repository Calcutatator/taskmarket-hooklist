import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 font-mono text-[0.65rem] font-semibold whitespace-nowrap uppercase tracking-[0.08em] transition-[color,background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-primary/60 bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-border/70 bg-secondary/88 text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-destructive/65 bg-destructive text-destructive-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90',
        outline:
          'border-border/72 bg-background/35 text-foreground [a&]:hover:bg-accent/12 [a&]:hover:text-foreground',
        ghost: '[a&]:hover:bg-accent/15 [a&]:hover:text-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        terminal:
          'border-border/68 bg-surface/80 text-muted-foreground shadow-[var(--shadow-soft)]',
        success: 'border-success/60 bg-success text-accent-foreground',
        warning: 'border-warning/60 bg-warning text-background',
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
