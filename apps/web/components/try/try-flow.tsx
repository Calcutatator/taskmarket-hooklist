'use client';

import { CheckIcon, FileTextIcon } from 'lucide-react';
import { motion, useInView } from 'motion/react';
import { useRef } from 'react';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import type { TryDrop } from '@/lib/try/drops';

type TryFlowProps = {
  drops: readonly TryDrop[];
};

const FLOW_EASE = [0.16, 1, 0.3, 1] as const;

export function TryFlow({ drops }: TryFlowProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.35, once: true });
  const motionDisabled = useMotionDisabled();
  const animate = motionDisabled || inView;
  const examples = drops.slice(0, 3);
  const accepted = examples[0];

  return (
    <div
      className="relative grid min-h-64 grid-cols-[minmax(0,1fr)] items-center gap-8 overflow-hidden border-y border-border/58 py-10 sm:grid-cols-[0.7fr_1.25fr_0.8fr] sm:gap-6 sm:py-12"
      data-motion={motionDisabled ? 'static' : 'animated'}
      ref={stageRef}
    >
      <div className="grid justify-items-center gap-3 text-center">
        <span className="grid size-14 place-items-center border border-border/68 bg-background text-primary shadow-[var(--shadow-control)]">
          <FileTextIcon aria-hidden="true" className="size-5" />
        </span>
        <p className="font-mono text-[0.7rem] font-semibold uppercase text-muted-foreground">
          Your brief
        </p>
      </div>

      <div aria-hidden="true" className="relative mx-auto h-44 w-full max-w-sm">
        {examples.map((drop, index) => (
          <div className="absolute inset-0 flex items-center justify-center" key={drop.taskId}>
            <motion.div
              animate={
                animate
                  ? {
                      opacity: 1,
                      rotate: (index - 1) * 7,
                      scale: 1,
                      x: (index - 1) * 54,
                      y: 0,
                    }
                  : {
                      opacity: 0.58,
                      rotate: (index - 1) * 3,
                      scale: 0.92,
                      x: (index - 1) * 30,
                      y: 8,
                    }
              }
              className="w-32 overflow-hidden bg-card shadow-[var(--shadow-elevated)] ring-1 ring-border/58 sm:w-36"
              initial={false}
              style={{ zIndex: examples.length - index }}
              transition={{ delay: index * 0.13, duration: 0.58, ease: FLOW_EASE }}
            >
              <img
                alt=""
                className="aspect-[4/5] w-full object-cover"
                height={drop.hero.height}
                loading="lazy"
                src={drop.hero.src}
                style={{ objectPosition: drop.cropPosition }}
                width={drop.hero.width}
              />
            </motion.div>
          </div>
        ))}
      </div>

      <motion.div
        animate={animate ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0.68, scale: 0.94, x: -8 }}
        className="grid justify-items-center gap-3 text-center"
        initial={false}
        transition={{ delay: 0.52, duration: 0.48, ease: FLOW_EASE }}
      >
        <span className="relative block w-28 overflow-hidden bg-card shadow-[var(--shadow-elevated)] ring-2 ring-primary sm:w-32">
          {accepted ? (
            <img
              alt=""
              className="aspect-[4/5] w-full object-cover"
              height={accepted.hero.height}
              loading="lazy"
              src={accepted.hero.src}
              style={{ objectPosition: accepted.cropPosition }}
              width={accepted.hero.width}
            />
          ) : null}
          <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon aria-hidden="true" className="size-4" />
          </span>
        </span>
        <p className="font-mono text-[0.7rem] font-semibold uppercase text-foreground">
          Your choice
        </p>
      </motion.div>
    </div>
  );
}
