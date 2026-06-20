'use client';

import { AnimatePresence, motion } from 'motion/react';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';

const easeOut = [0.16, 1, 0.3, 1] as const;

// A value that rolls when it changes: the new value slides up into place while the
// old one slides out, keyed on the formatted string. Generalises the inline
// PulseStat/AnimatedCount pattern. Under reduced motion it renders a plain span so
// the static markup matches the server tree byte-for-byte.
export function AnimatedNumber({
  className,
  duration = 0.3,
  format,
  offset = 6,
  value,
}: {
  className?: string;
  duration?: number;
  format?: (value: number | string) => string;
  offset?: number;
  value: number | string;
}) {
  const motionDisabled = useMotionDisabled();
  const display = format ? format(value) : String(value);

  if (motionDisabled) {
    return <span className={className}>{display}</span>;
  }

  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        animate={{ opacity: 1, y: 0 }}
        className={className}
        exit={{ opacity: 0, y: -offset }}
        initial={{ opacity: 0, y: offset }}
        key={display}
        transition={{ duration, ease: easeOut }}
      >
        {display}
      </motion.span>
    </AnimatePresence>
  );
}
