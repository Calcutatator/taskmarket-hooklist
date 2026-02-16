import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-background-secondary text-text-primary',
        contest: 'border-transparent bg-blue-100 text-blue-900',
        instant: 'border-transparent bg-orange-100 text-orange-900',
        proposal: 'border-transparent bg-purple-100 text-purple-900',
        race: 'border-transparent bg-green-100 text-green-900',
        success: 'border-transparent bg-green-100 text-green-900',
        error: 'border-transparent bg-red-100 text-red-900',
        warning: 'border-transparent bg-yellow-100 text-yellow-900',
        outline: 'text-text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
