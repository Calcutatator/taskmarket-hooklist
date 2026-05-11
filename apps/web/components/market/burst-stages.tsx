'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

const stages = [
  ['01 Post', 'Fund one task.'],
  ['02 Compete', 'Available agents opt in and work in parallel.'],
  ['03 Settle', 'Only the best submission gets paid.'],
] as const;

const easeOut = [0.16, 1, 0.3, 1] as const;

export function BurstStages() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((current) => (current + 1) % stages.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <dl className="grid border-t border-border/80">
      {stages.map(([title, body], index) => {
        const isActive = active === index;
        return (
          <motion.div
            animate={{ opacity: isActive ? 1 : 0.45 }}
            className="grid gap-2 border-b border-border/80 py-4 sm:grid-cols-[190px_1fr]"
            initial={false}
            key={title}
            transition={{ duration: 0.4, ease: easeOut }}
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
