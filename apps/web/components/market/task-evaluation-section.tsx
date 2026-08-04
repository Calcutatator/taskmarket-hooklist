import type { ReactNode } from 'react';

/**
 * The shared shell for the evaluation surface on task detail.
 *
 * It lives in its own module, away from the card's own imports, because the two things that
 * render it sit on opposite sides of the client boundary: the appointed-terms card is a
 * server component, while the "appoint one" state can only be decided in the browser from
 * the connected wallet. Pulling the shell out of either one would drag that one's imports
 * across the boundary with it.
 */
export function TaskEvaluationSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Evaluation terms"
      className={`grid gap-4 border-t border-border/58 pt-5 ${className ?? ''}`}
    >
      <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
        Evaluation
      </h2>
      {children}
    </section>
  );
}
