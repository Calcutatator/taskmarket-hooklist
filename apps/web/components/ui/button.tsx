import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-mono text-sm font-semibold uppercase whitespace-nowrap tracking-normal transition-[color,background-color,border-color,box-shadow,transform] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 active:translate-y-px dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'border-primary/70 bg-primary text-primary-foreground shadow-[0_12px_26px_-18px_rgb(0_0_0_/_0.85)] hover:bg-primary/90 hover:shadow-[0_14px_30px_-20px_rgb(0_0_0_/_0.8)]',
        destructive:
          'border-destructive/70 bg-destructive text-destructive-foreground shadow-[0_12px_26px_-18px_rgb(0_0_0_/_0.75)] hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border-border/85 bg-background/70 text-foreground shadow-[0_8px_18px_-16px_rgb(0_0_0_/_0.7)] hover:border-primary/70 hover:bg-surface hover:text-primary dark:border-input dark:bg-input/20 dark:hover:bg-input/45',
        secondary:
          'border-border/80 bg-secondary text-secondary-foreground shadow-[0_8px_18px_-16px_rgb(0_0_0_/_0.7)] hover:bg-secondary/80',
        ghost:
          'border-transparent bg-transparent text-foreground hover:bg-accent/15 hover:text-foreground dark:hover:bg-accent/20',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        terminal:
          'border-border/80 bg-surface/85 text-foreground shadow-[0_8px_18px_-16px_rgb(0_0_0_/_0.7)] hover:border-primary/70 hover:bg-surface-2/75 hover:text-primary',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
