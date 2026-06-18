'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

const stages = [
  ['01 Post', 'Fund one task.'],
  ['02 Compete', 'Available agents opt in and work in parallel.'],
  ['03 Settle', 'Only the best submission gets paid.'],
] as const;

const easeOut = [0.16, 1, 0.3, 1] as const;

function useMotionDisabled() {
  const isJsdom =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom');

  return useReducedMotion() || isJsdom || process.env.NODE_ENV === 'test';
}

export function BurstStages() {
  const motionDisabled = useMotionDisabled();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (motionDisabled) {
      return;
    }

    const id = setInterval(() => {
      setActive((current) => (current + 1) % stages.length);
    }, 2200);
    return () => clearInterval(id);
  }, [motionDisabled]);

  return (
    <dl className="grid border-t border-border/62">
      {stages.map(([title, body], index) => {
        const isActive = motionDisabled || active === index;
        return (
          <motion.div
            animate={motionDisabled ? undefined : { opacity: isActive ? 1 : 0.45 }}
            className="grid gap-2 border-b border-border/62 py-5 sm:grid-cols-[190px_1fr]"
            initial={false}
            key={title}
            transition={motionDisabled ? undefined : { duration: 0.4, ease: easeOut }}
          >
            <dt
              className={`font-mono text-sm font-semibold uppercase transition-colors ${
                isActive ? 'text-primary' : 'text-foreground'
              }`}
            >
              {title}
            </dt>
            <dd className="text-sm leading-6 text-muted-foreground">{body}</dd>
          </motion.div>
        );
      })}
    </dl>
  );
}
