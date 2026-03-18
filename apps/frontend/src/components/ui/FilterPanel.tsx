import { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { cn } from '@/lib/utils';

interface FilterPanelProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function FilterPanel({
  title,
  description,
  children,
  className,
  contentClassName,
}: FilterPanelProps) {
  return (
    <Card className={cn('bg-background-secondary shadow-soft', className)}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-xl">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={cn('space-y-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}
