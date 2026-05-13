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
          'border-primary/76 bg-primary text-primary-foreground shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.14)] [a&]:hover:bg-primary/92',
        secondary:
          'border-border/78 bg-secondary/92 text-secondary-foreground shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.1)] [a&]:hover:bg-secondary',
        destructive:
          'border-destructive/76 bg-destructive text-destructive-foreground shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.12)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/92',
        outline:
          'border-border/78 bg-background/46 text-foreground shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.08)] [a&]:hover:bg-accent/14 [a&]:hover:text-foreground',
        ghost: '[a&]:hover:bg-accent/15 [a&]:hover:text-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        terminal:
          'border-border/78 bg-surface/90 text-foreground/84 shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.09)]',
        success:
          'border-success/72 bg-success text-accent-foreground shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.13)]',
        warning:
          'border-warning/72 bg-warning text-background shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.13)]',
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
