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
          'border-primary/80 bg-primary text-primary-foreground shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.16)] hover:-translate-y-0.5 hover:border-primary hover:bg-primary/92 hover:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.2)]',
        destructive:
          'border-destructive/78 bg-destructive text-destructive-foreground shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.14)] hover:-translate-y-0.5 hover:border-destructive hover:bg-destructive/92 hover:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.18)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border-border/82 bg-background/50 text-foreground shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.08)] hover:-translate-y-0.5 hover:border-primary/54 hover:bg-surface-2/58 hover:text-primary hover:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.1)] dark:border-input/86 dark:bg-input/24 dark:hover:bg-input/42',
        secondary:
          'border-border/78 bg-secondary text-secondary-foreground shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.1)] hover:-translate-y-0.5 hover:border-accent/36 hover:bg-secondary/78 hover:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.12)]',
        ghost:
          'border-transparent bg-transparent text-foreground hover:bg-accent/12 hover:text-foreground dark:hover:bg-accent/18',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        terminal:
          'border-border/82 bg-surface/58 text-foreground shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.09)] hover:-translate-y-0.5 hover:border-primary/54 hover:bg-surface-2/60 hover:text-primary hover:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.11)]',
        chip: 'border-border/68 bg-background/36 font-mono uppercase tracking-tight text-foreground shadow-[var(--shadow-soft),inset_0_1px_0_rgb(255_255_255_/_0.06)] hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/10 hover:text-primary hover:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.08)] data-[active=true]:border-primary/56 data-[active=true]:bg-primary/12 data-[active=true]:text-primary data-[active=true]:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.1)]',
      },
      size: {
        default: 'min-h-11 px-4 py-2 has-[>svg]:px-3.5 sm:h-10',
        xs: "min-h-11 gap-1 px-3 text-xs has-[>svg]:px-2.5 sm:h-7 sm:px-2.5 sm:has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: 'min-h-11 gap-1.5 px-3.5 has-[>svg]:px-3 sm:h-9',
        lg: 'h-11 px-6 has-[>svg]:px-4',
        chip: "min-h-11 gap-1.5 px-3 text-xs has-[>svg]:px-2.5 sm:h-9 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-11 sm:size-10',
        'icon-xs': "size-11 md:size-7 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-11 sm:size-9',
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
