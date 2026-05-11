import { Link } from '@tanstack/react-router';
import { type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TerminalSectionProps {
  eyebrow: string;
  ascii?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function TerminalSection({
  eyebrow,
  ascii,
  children,
  className,
  contentClassName,
}: TerminalSectionProps) {
  return (
    <section className={cn('tm-section', className)}>
      <div className={cn('tm-container', contentClassName)}>
        <div className="mb-6 flex items-baseline gap-4">
          <p className="tm-eyebrow">{eyebrow}</p>
          <span className="tm-rule" />
          {ascii && (
            <span className="tm-faint hidden font-mono text-[11px] lg:inline">{ascii}</span>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

interface TerminalCardProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode;
}

export function TerminalCard({ children, className, ...props }: TerminalCardProps) {
  return (
    <div className={cn('tm-card', className)} {...props}>
      <span className="tm-card-corner pointer-events-none absolute -left-px -top-px h-2.5 w-2.5 border-l border-t" />
      <span className="tm-card-corner pointer-events-none absolute -right-px -top-px h-2.5 w-2.5 border-r border-t" />
      <span className="tm-card-corner pointer-events-none absolute -bottom-px -left-px h-2.5 w-2.5 border-b border-l" />
      <span className="tm-card-corner pointer-events-none absolute -bottom-px -right-px h-2.5 w-2.5 border-b border-r" />
      {children}
    </div>
  );
}

interface TerminalButtonProps extends ComponentPropsWithoutRef<typeof Button> {
  to?: string;
  href?: string;
  external?: boolean;
}

export function TerminalButton({
  className,
  children,
  to,
  href,
  external,
  variant = 'outline',
  ...props
}: TerminalButtonProps) {
  const buttonClassName = cn(
    'tm-btn',
    variant === 'default' ? 'tm-btn-primary' : 'tm-btn-outline',
    className
  );

  if (to) {
    return (
      <Button asChild variant={variant} className={buttonClassName} {...props}>
        <Link to={to}>{children}</Link>
      </Button>
    );
  }

  if (href) {
    return (
      <Button asChild variant={variant} className={buttonClassName} {...props}>
        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer' : undefined}
        >
          {children}
        </a>
      </Button>
    );
  }

  return (
    <Button variant={variant} className={buttonClassName} {...props}>
      {children}
    </Button>
  );
}

interface TerminalChipProps extends ComponentPropsWithoutRef<'span'> {
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'error';
}

export function TerminalChip({
  tone = 'default',
  className,
  children,
  ...props
}: TerminalChipProps) {
  return (
    <span
      className={cn(
        'tm-chip',
        tone === 'default' && 'tm-chip-default',
        tone === 'accent' && 'tm-chip-accent',
        tone === 'success' && 'tm-chip-success',
        tone === 'warning' && 'tm-chip-warning',
        tone === 'error' && 'tm-chip-error',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  tone = 'success',
}: {
  tone?: 'success' | 'warning' | 'error' | 'accent';
}) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        tone === 'success' && 'bg-state-success-primary',
        tone === 'warning' && 'bg-state-warning-primary',
        tone === 'error' && 'bg-state-error-primary',
        tone === 'accent' && 'bg-button-primary-bg'
      )}
    />
  );
}
