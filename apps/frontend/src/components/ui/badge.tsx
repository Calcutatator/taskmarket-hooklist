import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-background-secondary text-text-primary',
        contest: 'border-transparent bg-badge-info-bg text-badge-info-text',
        instant: 'border-transparent bg-badge-warning-bg text-badge-warning-text',
        proposal: 'border-transparent bg-badge-secondary-bg text-badge-secondary-text',
        race: 'border-transparent bg-badge-success-bg text-badge-success-text',
        success: 'border-transparent bg-badge-success-bg text-badge-success-text',
        error: 'border-transparent bg-badge-error-bg text-badge-error-text',
        warning: 'border-transparent bg-badge-warning-bg text-badge-warning-text',
        outline: 'text-text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
