import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-sans text-sm font-semibold whitespace-nowrap tracking-tight transition-[color,background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 active:scale-[0.98] dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-[var(--ease-premium)] [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'border-primary/65 bg-primary text-primary-foreground shadow-[var(--shadow-control)] hover:border-primary/80 hover:bg-primary/90 hover:shadow-[var(--shadow-elevated)]',
        destructive:
          'border-destructive/65 bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border-border/75 bg-background/55 text-foreground shadow-[var(--shadow-control)] hover:border-primary/55 hover:bg-surface-2/70 hover:text-primary dark:border-input/80 dark:bg-input/20 dark:hover:bg-input/42',
        secondary:
          'border-border/70 bg-secondary text-secondary-foreground shadow-[var(--shadow-control)] hover:bg-secondary/82',
        ghost:
          'border-transparent bg-transparent text-foreground hover:bg-accent/12 hover:text-foreground dark:hover:bg-accent/18',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        terminal:
          'border-border/72 bg-surface/80 text-foreground shadow-[var(--shadow-control)] hover:border-primary/55 hover:bg-surface-2/72 hover:text-primary',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3.5',
        xs: "h-7 gap-1 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-9 gap-1.5 px-3.5 has-[>svg]:px-3',
        lg: 'h-11 px-6 has-[>svg]:px-4',
        icon: 'size-10',
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-9',
        'icon-lg': 'size-11',
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
