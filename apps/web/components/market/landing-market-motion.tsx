'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { useHydrationSafeMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { cn } from '@/lib/utils';

const loopDuration = 4.8;
const pulseTimes = [0, 0.16, 0.32, 1];
const pulseEase = [0.16, 1, 0.3, 1] as const;

export function LandingRolePulse({
  children,
  className,
  motionId,
  pulseDelay,
}: {
  children: ReactNode;
  className?: string;
  motionId: string;
  pulseDelay: number;
}) {
  const motionDisabled = useHydrationSafeMotionDisabled();
  const transition = motionDisabled
    ? undefined
    : {
        delay: pulseDelay,
        duration: loopDuration,
        ease: pulseEase,
        repeat: Infinity,
        times: pulseTimes,
      };

  return (
    <motion.div
      animate={motionDisabled ? undefined : { scale: [1, 1.014, 1, 1] }}
      className={cn(
        'relative grid h-full min-h-48 content-between gap-7 overflow-hidden rounded-2xl border border-border/64 bg-background/72 p-5 shadow-[var(--shadow-soft)]',
        className
      )}
      data-motion={motionId}
      transition={transition}
    >
      <motion.span
        animate={
          motionDisabled ? undefined : { opacity: [0, 0.62, 0, 0], scale: [0.985, 1, 1.015, 1.015] }
        }
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/48"
        transition={transition}
      />
      {children}
    </motion.div>
  );
}

export function LandingCorePulse({ children }: { children: ReactNode }) {
  const motionDisabled = useHydrationSafeMotionDisabled();

  return (
    <motion.span
      animate={motionDisabled ? undefined : { scale: [1, 1.025, 1, 1] }}
      className="relative z-1 flex size-16 items-center justify-center rounded-2xl border border-primary/34 bg-background/76 shadow-[var(--shadow-soft)]"
      data-testid="taskmarket-center-logo"
      transition={
        motionDisabled
          ? undefined
          : {
              delay: 0.9,
              duration: loopDuration,
              ease: pulseEase,
              repeat: Infinity,
              times: [0, 0.2, 0.4, 1],
            }
      }
    >
      {children}
    </motion.span>
  );
}

export function LandingFlowPulse({
  axis,
  delay,
  reverse = false,
}: {
  axis: 'horizontal' | 'vertical';
  delay: number;
  reverse?: boolean;
}) {
  const motionDisabled = useHydrationSafeMotionDisabled();
  const travel = reverse ? ['300%', '-100%'] : ['-100%', '300%'];

  return (
    <motion.span
      animate={
        motionDisabled
          ? undefined
          : axis === 'horizontal'
            ? { opacity: [0, 1, 1, 0], x: travel }
            : { opacity: [0, 1, 1, 0], y: travel }
      }
      className={cn(
        'absolute rounded-full bg-current',
        axis === 'horizontal' && 'top-1/2 h-0.5 w-1/3 -translate-y-1/2',
        axis === 'vertical' && 'left-1/2 h-1/3 w-0.5 -translate-x-1/2'
      )}
      transition={
        motionDisabled
          ? undefined
          : {
              delay,
              duration: 0.9,
              ease: pulseEase,
              repeat: Infinity,
              repeatDelay: loopDuration - 0.9,
            }
      }
    />
  );
}
