'use client';

import { CircleCheckIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { TaskResponse } from '@taskmarket/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { Button } from '@/components/ui/button';
import { emitActionInboxEvent } from '@/lib/market/action-inbox-events';

import { requesterWaitingCopy } from './requester-task-guidance';

const easeOut = [0.16, 1, 0.3, 1] as const;

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, transition: { duration: 0.72, ease: easeOut }, y: 0 },
};

const groupVariants = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { delayChildren: 0.1, staggerChildren: 0.1 } },
};

export function PublishedCelebration({ task }: { task: TaskResponse }) {
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
    emitActionInboxEvent({ event: 'post_publication_guidance_seen', taskId: task.id });

    toast.success('Task published', {
      description: 'Your task is live - reaching workers now',
    });

    // Run once on mount for a published reveal; handledRef guards re-entry.
  }, [published, task.id]);

  if (!published || !visible) {
    return null;
  }

  return (
    <motion.div
      animate="show"
      className="rounded-xl border border-border/68 bg-surface/42 p-6 shadow-[var(--shadow-soft)]"
      initial={motionDisabled ? false : 'hidden'}
      style={{ boxShadow: '0 0 0 1px color-mix(in oklab, var(--success) 28%, transparent)' }}
      variants={groupVariants}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--success)]"
            initial={motionDisabled ? false : { opacity: 0, scale: 0.6 }}
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
              No action is needed right now
            </motion.p>
            <motion.p
              className="max-w-2xl text-sm leading-5 text-muted-foreground"
              variants={itemVariants}
            >
              {requesterWaitingCopy(task)}
            </motion.p>
          </div>
        </div>
        <motion.div className="flex flex-wrap gap-2" variants={itemVariants}>
          {taskDropId ? (
            <Button asChild type="button" variant="outline">
              <Link href={`/drops/${taskDropId}` as Route}>View drop</Link>
            </Button>
          ) : null}
          <Button asChild type="button" variant="outline">
            <Link href={'/dashboard/inbox' as Route}>Open Inbox</Link>
          </Button>
          <Button onClick={dismiss} type="button" variant="outline">
            View activity
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
