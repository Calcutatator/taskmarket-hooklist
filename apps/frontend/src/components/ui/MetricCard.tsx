import { Card, CardContent } from './card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  value: string;
  label: string;
  description?: string;
  className?: string;
}

export function MetricCard({ value, label, description, className }: MetricCardProps) {
  return (
    <Card className={cn('h-full bg-background-secondary shadow-soft', className)}>
      <CardContent className="space-y-2 pt-0">
        <p className="text-3xl font-bold tracking-tight text-text-primary">{value}</p>
        <div className="space-y-1">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-text-tertiary">{label}</p>
          {description && <p className="text-sm text-text-secondary">{description}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
