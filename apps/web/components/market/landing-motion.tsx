'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';

import { useHydrationSafeMotionDisabled } from '@/components/market/motion/use-motion-disabled';

type MotionShellProps = {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
  delay?: number;
  motionId: string;
  stagger?: number;
};

const easeOut = [0.16, 1, 0.3, 1] as const;

function groupVariants(delay = 0, stagger = 0.1) {
  return {
    hidden: { opacity: 1 },
    show: {
      opacity: 1,
      transition: {
        delayChildren: delay,
        staggerChildren: stagger,
      },
    },
  };
}

const itemVariants = {
  hidden: {
    // Critical landing content must remain readable if hydration or the
    // animation scheduler stalls. The entrance motion is a translation from a
    // visible state rather than a reveal from transparency.
    opacity: 1,
    y: 18,
  },
  show: {
    opacity: 1,
    transition: {
      duration: 0.72,
      ease: easeOut,
    },
    y: 0,
  },
};

export function LandingMotionGroup({
  children,
  className,
  'data-testid': testId,
  delay,
  motionId,
  stagger,
}: MotionShellProps) {
  const motionDisabled = useHydrationSafeMotionDisabled();

  return (
    <motion.div
      animate={motionDisabled ? undefined : 'show'}
      className={className}
      data-motion={motionId}
      data-testid={testId}
      initial={motionDisabled ? false : 'hidden'}
      variants={motionDisabled ? undefined : groupVariants(delay, stagger)}
    >
      {children}
    </motion.div>
  );
}

export function LandingMotionItem({
  children,
  className,
  motionId,
}: Omit<MotionShellProps, 'delay' | 'stagger'>) {
  const motionDisabled = useHydrationSafeMotionDisabled();

  return (
    <motion.div
      className={className}
      data-motion={motionId}
      variants={motionDisabled ? undefined : itemVariants}
    >
      {children}
    </motion.div>
  );
}

export function LandingMotionAction({
  children,
  className,
  motionId,
}: Omit<MotionShellProps, 'delay' | 'stagger'>) {
  const motionDisabled = useHydrationSafeMotionDisabled();

  return (
    <motion.div
      className={className}
      data-motion={motionId}
      variants={motionDisabled ? undefined : itemVariants}
      whileHover={motionDisabled ? undefined : { scale: 1.015, y: -2 }}
      whileTap={motionDisabled ? undefined : { scale: 0.985, y: 0 }}
    >
      {children}
    </motion.div>
  );
}

export function LandingMotionSection({
  children,
  motionId,
}: Pick<MotionShellProps, 'children' | 'motionId'>) {
  const motionDisabled = useHydrationSafeMotionDisabled();
  const canUseViewportAnimation = !motionDisabled;

  return (
    <motion.div
      animate={canUseViewportAnimation ? undefined : { opacity: 1, y: 0 }}
      data-motion={motionId}
      initial={canUseViewportAnimation ? { opacity: 1, y: 28 } : false}
      transition={{ duration: 0.78, ease: easeOut }}
      viewport={{ amount: 0.16, margin: '-80px 0px', once: true }}
      whileInView={canUseViewportAnimation ? { opacity: 1, y: 0 } : undefined}
    >
      {children}
    </motion.div>
  );
}
