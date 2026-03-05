import { cn } from '@/lib/utils';

interface BracketCardProps {
  children: React.ReactNode;
  className?: string;
}

export function BracketCard({ children, className }: BracketCardProps) {
  return (
    <div className={cn('relative', className)}>
      <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-sidebar-item-active pointer-events-none" />
      <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-sidebar-item-active pointer-events-none" />
      {children}
    </div>
  );
}
