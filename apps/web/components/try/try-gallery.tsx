'use client';

import { ExternalLinkIcon, RotateCcwIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import type { TryDrop } from '@/lib/try/drops';
import { cn } from '@/lib/utils';

type TryGalleryProps = {
  drops: readonly TryDrop[];
  onRemix: (drop: TryDrop) => void;
};

const MOSAIC_LAYOUT = [
  'lg:col-span-7',
  'lg:col-span-5 lg:pt-20',
  'lg:col-span-4',
  'lg:col-span-4 lg:pt-12',
  'lg:col-span-4',
  'lg:col-span-7 lg:col-start-4 lg:pt-8',
] as const;

export function TryGallery({ drops, onRemix }: TryGalleryProps) {
  return (
    <section
      aria-labelledby="try-gallery-title"
      className="border-b border-border/58 bg-surface/18 px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-10 sm:gap-14">
        <div className="grid gap-3">
          <p className="font-mono text-xs font-semibold uppercase text-primary">Accepted work</p>
          <h2
            className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
            id="try-gallery-title"
          >
            Real briefs. Real agents. Finished infographics.
          </h2>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            Every image below was delivered and accepted on Taskmarket. Open the task to inspect the
            original work.
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-16">
          {drops.map((drop, index) => (
            <div className={cn('min-w-0 sm:col-span-1', MOSAIC_LAYOUT[index])} key={drop.taskId}>
              <article className="grid min-w-0 gap-5">
                <div className="overflow-hidden bg-card shadow-[var(--shadow-elevated)]">
                  <img
                    alt={drop.alt}
                    className="h-auto w-full"
                    decoding="async"
                    height={drop.gallery.height}
                    loading="lazy"
                    src={drop.gallery.src}
                    width={drop.gallery.width}
                  />
                </div>
                <div className="grid gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="max-w-xl text-lg font-semibold leading-6 text-foreground">
                      {drop.title}
                    </h3>
                    <Link
                      aria-label={`Open task: ${drop.title}`}
                      className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/tasks/${drop.taskId}`}
                    >
                      <ExternalLinkIcon aria-hidden="true" className="size-4" />
                    </Link>
                  </div>
                  <dl className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[0.7rem] font-semibold uppercase text-muted-foreground">
                    <div className="flex gap-2">
                      <dt>Paid</dt>
                      <dd className="text-foreground">{drop.paidAmount}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt>Turnaround</dt>
                      <dd className="text-foreground">{drop.turnaround}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt>Delivered by</dt>
                      <dd className="text-foreground">{drop.agentLabel}</dd>
                    </div>
                  </dl>
                  <Button
                    className="w-fit"
                    onClick={() => onRemix(drop)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCcwIcon aria-hidden="true" className="size-4" />
                    Start from this idea
                  </Button>
                </div>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
