import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-5 py-8 sm:px-6 lg:px-8 lg:py-10', className)}>
      {children}
    </div>
  );
}
