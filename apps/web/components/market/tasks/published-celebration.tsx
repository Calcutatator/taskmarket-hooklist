'use client';

import { CircleCheckIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { Button } from '@/components/ui/button';

const easeOut = [0.16, 1, 0.3, 1] as const;

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, transition: { duration: 0.72, ease: easeOut }, y: 0 },
};

const groupVariants = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { delayChildren: 0.1, staggerChildren: 0.1 } },
};

const REVEAL_DURATION_MS = 2_200;

export function PublishedCelebration() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const motionDisabled = useMotionDisabled();

  const published = searchParams?.get('published') === '1';
  const taskDropId = searchParams?.get('taskDropId');
  const [visible, setVisible] = useState(published);
  const handledRef = useRef(false);

  // Smooth-scroll to the live activity feed, then strip the param so a refresh or
  // back-nav never replays the reveal. Reduced-motion uses an instant scroll.
  function dismiss() {
    setVisible(false);

    if (typeof document !== 'undefined') {
      const target = document.getElementById('task-activity');
      target?.scrollIntoView({ behavior: motionDisabled ? 'auto' : 'smooth' });
    }

    if (pathname) {
      router.replace(pathname as Route, { scroll: false });
    }
  }

  useEffect(() => {
    if (!published || handledRef.current) {
      return;
    }
    handledRef.current = true;

    toast.success('Task published', {
      description: 'Your task is live - reaching workers now',
    });

    // Under reduced motion we never mount the visual reveal, so strip the param
    // immediately (the toast still fires) and skip the smooth scroll.
    if (motionDisabled) {
      setVisible(false);
      if (pathname) {
        router.replace(pathname as Route, { scroll: false });
      }
      return;
    }

    if (taskDropId) {
      return;
    }

    const timer = setTimeout(dismiss, REVEAL_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
    // Run once on mount for a published reveal; handledRef guards re-entry and the
    // router/pathname/dismiss closures are stable across this component's life.
  }, [published]);

  if (!published || !visible || motionDisabled) {
    return null;
  }

  return (
    <motion.div
      animate="show"
      className="rounded-xl border border-border/68 bg-surface/42 p-6 shadow-[var(--shadow-soft)] lg:col-span-2"
      initial="hidden"
      style={{ boxShadow: '0 0 0 1px color-mix(in oklab, var(--success) 28%, transparent)' }}
      variants={groupVariants}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--success)]"
            initial={{ opacity: 0, scale: 0.6 }}
            style={{
              backgroundColor: 'color-mix(in oklab, var(--success) 16%, transparent)',
            }}
            transition={{ duration: 0.5, ease: easeOut }}
          >
            <CircleCheckIcon className="size-6" />
          </motion.span>
          <div className="grid gap-1">
            <motion.p
              className="font-display text-lg font-semibold tracking-tight text-foreground"
              variants={itemVariants}
            >
              Task published
            </motion.p>
            <motion.p className="text-sm leading-5 text-muted-foreground" variants={itemVariants}>
              Your task is live - reaching workers now.
            </motion.p>
          </div>
        </div>
        <motion.div className="flex flex-wrap gap-2" variants={itemVariants}>
          {taskDropId ? (
            <Button asChild type="button" variant="outline">
              <Link href={`/drops/${taskDropId}` as Route}>View drop</Link>
            </Button>
          ) : null}
          <Button onClick={dismiss} type="button" variant="outline">
            View activity
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
