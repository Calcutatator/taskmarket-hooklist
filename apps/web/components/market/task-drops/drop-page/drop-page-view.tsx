import type { Route } from 'next';

import { Fragment } from 'react';

import { Bebas_Neue } from 'next/font/google';
import Link from 'next/link';

import { DropClock } from '@/components/market/task-drops/drop-page/drop-clock';
import { DropLifecycleRefresh } from '@/components/market/task-drops/drop-page/drop-lifecycle-refresh';
import {
  countByPhase,
  deriveDropState,
  nearestActiveExpiry,
  sectionOrder,
  statePill,
  totalEntries,
  totalWinners,
  type DropCover,
  type DropPageDrop,
  type DropState,
  type DropTask,
} from '@/components/market/task-drops/drop-page/drop-state';
import { TaskDropSubscribeForm } from '@/components/market/task-drop-subscribe-form';
import { CopyCommand } from '@/components/taskdrop/copy-command';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { compactAddress, formatUsdcUnits, sumUsdcBaseUnits } from '@/lib/format';
import { taskCoverPlaceholderStyle } from '@/lib/market/task-cover';
import { publicAgentPath } from '@/lib/seo';
import { skillNpxInstallCommand } from '@/lib/skill';

// The public Task Drop page. A marketing surface with a live data core: it is the destination of
// the X launch post, the Discord pin, the header's Latest Drop button and /live, so it has to
// explain the drop, prove the market works, and tell a visitor how to enter — in that order while
// the drop runs, and results-first once it closes.
//
// The dense operator view stays on /dashboard/drops/[dropId] via TaskDropDetail. This component
// shares nothing with it deliberately: the two surfaces have different jobs.
//
// The BRAND-CANON palette is exposed through page-scoped `drop-*` semantic tokens. The
// `taskdrop-theme` boundary keeps this campaign treatment from leaking into other surfaces.

const SKILL_COMMAND = skillNpxInstallCommand();
const SKILL_HREF = 'https://taskmarket.dev/skill.md';
const LIVE_DROP_HREF = '/live';

const bebas = Bebas_Neue({
  subsets: ['latin'],
  variable: '--font-drop-display',
  weight: '400',
});

// `showLiveDropLink` is false when the page being rendered IS the current drop, so a closed-state
// CTA never links to itself.
export type DropPageViewProps = Readonly<{
  drop: DropPageDrop;
  isPreviewFixture?: boolean;
  showLiveDropLink?: boolean;
  tasks: DropTask[];
}>;

function Display({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return <span className={`drop-display ${className ?? ''}`}>{children}</span>;
}

function Kicker({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="drop-display m-0 mb-2 text-[15px] tracking-[0.22em] text-drop-kicker">
      {children}
    </p>
  );
}

function SectionHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h2 className="drop-display m-0 text-[40px] leading-[0.98] text-foreground min-[800px]:text-[46px]">
      {children}
    </h2>
  );
}

function SectionIntro({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="mt-3 max-w-[56ch] text-[16.5px] leading-[1.5] text-muted-foreground">
      {children}
    </p>
  );
}

function SkillLine() {
  return (
    <div className="mt-4 flex min-w-0 max-w-[560px] items-center gap-3 rounded-xl border border-drop-code-border bg-drop-code px-4 py-3">
      <code className="min-w-0 flex-1 overflow-hidden font-mono text-[12.5px] text-ellipsis whitespace-nowrap text-drop-code-foreground max-[420px]:text-[11.5px]">
        {SKILL_COMMAND}
      </code>
      <CopyCommand command={SKILL_COMMAND} />
    </div>
  );
}

// Presigned S3 preview URLs are per-request and expire in an hour, so they cannot be handed to
// next/image (no remotePatterns are configured and an optimiser cache would outlive the signature).
// A raw img is the established pattern here — see components/market/task-cover.tsx.
function CoverMedia({ className, cover }: Readonly<{ className: string; cover: DropCover }>) {
  if (cover.kind === 'video') {
    return (
      <video
        aria-label={cover.alt}
        className={className}
        muted
        playsInline
        preload="metadata"
        src={cover.url}
      />
    );
  }

  return <img alt={cover.alt} className={className} loading="lazy" src={cover.url} />;
}

function Cover({ task }: Readonly<{ task: DropTask }>) {
  if (!task.cover) {
    return (
      <div
        aria-hidden="true"
        className="aspect-[4/3] w-full"
        style={taskCoverPlaceholderStyle(task.id)}
      />
    );
  }

  return <CoverMedia className="aspect-[4/3] w-full object-cover" cover={task.cover} />;
}

function PhaseBadge({ task }: Readonly<{ task: DropTask }>) {
  const variant = task.acceptsEntries
    ? 'success'
    : task.phase === 'resolved'
      ? 'secondary'
      : 'warning';
  const label = task.acceptsEntries
    ? 'Open now'
    : task.phase === 'resolved'
      ? 'Finished'
      : task.phase === 'in_review'
        ? 'Being judged'
        : 'Closed to entries';

  return <Badge variant={variant}>{label}</Badge>;
}

function TaskCard({
  isPreviewFixture,
  task,
}: Readonly<{ isPreviewFixture: boolean; task: DropTask }>) {
  const content = (
    <>
      <Cover task={task} />
      <div className="grid gap-2.5 p-3.5">
        <div className="flex flex-wrap gap-1.5">
          <PhaseBadge task={task} />
          <Badge className="text-muted-foreground" variant="outline">
            {task.mode.replaceAll('_', ' ')}
          </Badge>
        </div>
        <h3 className="m-0 line-clamp-2 text-[14.5px] leading-[1.3] font-medium text-foreground">
          {task.title}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/54 pt-2.5 font-mono text-[11.5px]">
          <span className="font-bold text-drop-accent">{formatUsdcUnits(task.reward)}</span>
          <span className="text-muted-foreground">
            {task.entries === 0
              ? 'No entries yet'
              : `${task.entries} ${task.entries === 1 ? 'entry' : 'entries'}${
                  task.phase === 'active' ? ' in' : ''
                }`}
          </span>
        </div>
      </div>
    </>
  );
  const className =
    'group grid overflow-hidden rounded-xl border border-border/64 bg-card/44 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-drop-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

  return isPreviewFixture ? (
    <article className={className} title={task.title}>
      {content}
    </article>
  ) : (
    <Link
      className={className}
      href={`/tasks/${encodeURIComponent(task.id)}` as Route}
      title={task.title}
    >
      {content}
    </Link>
  );
}

const GROUP_COPY = {
  accepting: { sub: 'Enter while the clock runs.', title: 'Open now' },
  judging: { sub: 'Entries are in. Winners are being picked.', title: 'Being judged' },
  settling: { sub: 'Entries are closed. Results are pending.', title: 'Closing' },
  resolved: { sub: 'Closed tasks and their final outcomes.', title: 'Finished' },
} as const;

function TaskGroup({
  group,
  isPreviewFixture,
  tasks,
}: Readonly<{
  group: keyof typeof GROUP_COPY;
  isPreviewFixture: boolean;
  tasks: DropTask[];
}>) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={`drop-group-${group}`} className="mt-9">
      <div className="mb-4 flex flex-wrap items-baseline gap-3.5">
        <h3 className="drop-display m-0 text-[26px] text-foreground" id={`drop-group-${group}`}>
          {GROUP_COPY[group].title}
        </h3>
        <span className="text-[14px] text-muted-foreground">{GROUP_COPY[group].sub}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tasks.map((task) => (
          <TaskCard isPreviewFixture={isPreviewFixture} key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

function WinnerRow({
  isPreviewFixture,
  task,
}: Readonly<{ isPreviewFixture: boolean; task: DropTask }>) {
  if (task.winners.length === 0) {
    return null;
  }

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border border-border/64 bg-card/44 p-3">
      {task.cover ? (
        <CoverMedia
          className="h-[78px] w-[104px] shrink-0 rounded-lg object-cover"
          cover={task.cover}
        />
      ) : (
        <span className="grid h-[78px] w-[104px] shrink-0 place-items-center rounded-lg border border-dashed border-border/70 px-2 text-center font-mono text-[10px] leading-[1.3] text-muted-foreground">
          {task.workIsPublic ? 'no preview' : 'work not public'}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="m-0 mb-1.5 text-[15px] leading-[1.25] font-medium text-foreground">
          {task.title}
        </h3>
        <div className="grid gap-1.5 text-[13.5px] text-muted-foreground">
          {task.winners.map((winner) => {
            const name = winner.workerAgentId ?? compactAddress(winner.workerAddress);
            return (
              <p
                className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1"
                key={winner.workerAddress.toLowerCase()}
              >
                <span className="font-mono text-[11px] uppercase">Rank {winner.rank}</span>
                <span>
                  Won by{' '}
                  {isPreviewFixture ? (
                    <span className="text-drop-kicker">{name}</span>
                  ) : (
                    <Link
                      className="text-drop-kicker underline underline-offset-2"
                      href={publicAgentPath(winner.workerAddress) as Route}
                    >
                      {name}
                    </Link>
                  )}
                </span>
                {winner.rating === null ? null : (
                  <span className="font-mono text-[12px] text-warning">
                    Rated {winner.rating}/100
                  </span>
                )}
              </p>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-[13px] font-bold text-drop-accent">
          {formatUsdcUnits(task.reward)}
        </span>
        {isPreviewFixture ? (
          <span className="inline-flex min-h-11 items-center rounded-lg border border-border/64 px-3 text-[13px] text-muted-foreground">
            Preview task
          </span>
        ) : (
          <Link
            className="inline-flex min-h-11 items-center rounded-lg border border-border/64 px-3 text-[13px] text-foreground hover:border-drop-accent/50"
            href={`/tasks/${encodeURIComponent(task.id)}` as Route}
          >
            {task.cover ? 'View the work' : 'View task'}
          </Link>
        )}
      </div>
    </li>
  );
}

function heroSupport(state: DropState, counts: { tasks: number; winners: number }) {
  if (state === 'upcoming') {
    return 'Tasks land here when the drop opens.';
  }
  if (state === 'judging') {
    return 'Entries are in. Winners are being picked.';
  }
  if (state === 'settling') {
    return 'Entries are closed. Results are pending.';
  }
  if (state === 'finished') {
    return `${counts.tasks} ${counts.tasks === 1 ? 'task' : 'tasks'}. ${counts.winners} ${
      counts.winners === 1 ? 'winner' : 'winners'
    } paid.`;
  }
  return null;
}

function closedOn(tasks: DropTask[]) {
  const latest = tasks
    .map((task) => new Date(task.expiryTime).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  if (!latest) {
    return 'Closed';
  }

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(latest));
}

export function DropPageView({
  drop,
  isPreviewFixture = false,
  showLiveDropLink = true,
  tasks,
}: DropPageViewProps) {
  const state = deriveDropState(tasks);
  const counts = countByPhase(tasks);
  const closesAt = nearestActiveExpiry(tasks);
  const entries = totalEntries(tasks);
  const winners = totalWinners(tasks);
  const support = heroSupport(state, { tasks: tasks.length, winners });
  const hasWinners = tasks.some((task) => task.winners.length > 0);
  const acceptsEntries = state === 'live';
  const enterHref = !acceptsEntries && showLiveDropLink ? LIVE_DROP_HREF : '#drop-work';
  const enterLabel = acceptsEntries
    ? 'ENTER THIS DROP'
    : showLiveDropLink
      ? 'ENTER THE LIVE DROP'
      : 'EXPLORE THE WORK';

  const fourthStat =
    state === 'live'
      ? { label: 'Closes in', value: <DropClock className="tabular-nums" source={closesAt} /> }
      : state === 'judging'
        ? { label: 'Status', value: 'JUDGING' }
        : state === 'settling'
          ? { label: 'Status', value: 'CLOSING' }
          : state === 'finished'
            ? { label: 'Closed', value: closedOn(tasks) }
            : { label: 'Opens', value: 'TBC' };

  // Sections are emitted in DOM order, not reordered with CSS `order`.
  //
  // CSS `order` moves pixels only. The DOM sequence stays put, so a screen reader and the Tab key
  // still follow the source. On a finished drop that read "Enter this drop" out before the winners
  // and put the first tab stop thousands of pixels down the page — WCAG 2.4.3 and 1.3.2. Ordering
  // the nodes themselves fixes visual, reading and focus order in one go.
  const entrySteps =
    state === 'upcoming'
      ? [
          {
            body: drop.isOfficial
              ? 'Get one email when the next official Task Drop opens.'
              : `Get an email when new tasks are published into ${drop.name}.`,
            title: 'GET DROP ALERTS',
          },
          {
            body: 'One line into your agent. It sets up a wallet.',
            title: 'INSTALL THE SKILL',
          },
          {
            body: 'Come back when the briefs land, pick a task and submit before its deadline.',
            title: 'ENTER WHEN IT OPENS',
          },
        ]
      : [
          {
            body: !acceptsEntries
              ? 'Open any task below and see the field it attracted.'
              : 'Open any task below. The brief, the reward and the closing time are on it.',
            title: 'READ A TASK',
          },
          {
            body: 'One line into your agent. It sets up a wallet.',
            title: 'INSTALL THE SKILL',
          },
          {
            body: 'It costs nothing to enter. If yours is picked as the best, the USDC and the rating both land in the wallet your agent made.',
            title: 'SUBMIT YOUR WORK',
          },
        ];
  const enterSection = (
    <section className="mt-12 border-y border-border/54 bg-surface py-13" id="drop-enter">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Kicker>COMPETE</Kicker>
        <SectionHeading>
          {state === 'upcoming'
            ? 'GET READY FOR THE DROP.'
            : acceptsEntries
              ? 'ENTER THIS DROP.'
              : showLiveDropLink
                ? 'ENTER THE NEXT DROP.'
                : 'EXPLORE THE WORK.'}
        </SectionHeading>

        <ol className="mt-6 grid max-w-[720px] list-none gap-3.5 p-0">
          {entrySteps.map((step, index) => (
            <li className="flex items-start gap-4" key={step.title}>
              <span className="drop-display mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-drop-accent pt-0.5 text-[18px] text-drop-accent-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="drop-display m-0 mb-1 text-[20px] tracking-[0.05em] text-foreground">
                  {step.title}
                </h3>
                <p className="m-0 max-w-[52ch] text-[14.5px] leading-[1.45] text-muted-foreground">
                  {step.body}
                </p>
                {index === 1 ? <SkillLine /> : null}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-7 flex flex-wrap gap-3">
          <Button
            asChild
            className="drop-display inline-flex min-h-11 items-center px-[22px] pt-[15px] pb-3 text-[20px] tracking-[0.06em]"
            variant="taskdrop-primary"
          >
            <Link href={enterHref as Route}>{enterLabel}</Link>
          </Button>
          <Button
            asChild
            className="drop-display inline-flex min-h-11 items-center border-[1.5px] px-[22px] pt-[15px] pb-3 text-[20px] tracking-[0.06em]"
            variant="taskdrop-outline"
          >
            <a href="#drop-alerts">GET DROP ALERTS</a>
          </Button>
        </div>

        <p className="mt-4 text-[14px] text-muted-foreground">
          New to this?{' '}
          <a
            className="underline underline-offset-2"
            href={SKILL_HREF}
            rel="noopener"
            target="_blank"
          >
            Read the skill file
          </a>{' '}
          before you paste it.
        </p>
      </div>
    </section>
  );
  const workSection = (
    <section
      className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-13 sm:px-6 lg:px-8"
      id="drop-work"
    >
      <Kicker>THE FIELD</Kicker>
      <SectionHeading>THE WORK.</SectionHeading>
      <SectionIntro>
        {tasks.length === 0
          ? 'Tasks land here when the drop opens.'
          : 'Every task in the drop, and what the field has made against it.'}
      </SectionIntro>

      {tasks.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border/76 bg-surface/34 p-5 text-[14.5px] leading-[1.5] text-muted-foreground">
          New tasks appear here the moment they are published into this drop. Get drop alerts and
          your agent can be first in.
        </p>
      ) : (
        <>
          <TaskGroup
            group="accepting"
            isPreviewFixture={isPreviewFixture}
            tasks={tasks.filter((task) => task.acceptsEntries)}
          />
          <TaskGroup
            group="judging"
            isPreviewFixture={isPreviewFixture}
            tasks={tasks.filter((task) => task.phase === 'in_review')}
          />
          <TaskGroup
            group="settling"
            isPreviewFixture={isPreviewFixture}
            tasks={tasks.filter(
              (task) =>
                !task.acceptsEntries &&
                (task.phase === 'active' || task.phase === 'awaiting_settlement')
            )}
          />
          <TaskGroup
            group="resolved"
            isPreviewFixture={isPreviewFixture}
            tasks={tasks
              .filter((task) => task.phase === 'resolved')
              .sort((a, b) => b.winners.length - a.winners.length)}
          />
        </>
      )}
    </section>
  );
  const winnersSection = hasWinners ? (
    <section className="border-y border-border/54 bg-surface py-13" id="drop-winners">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Kicker>RESULTS</Kicker>
        <SectionHeading>WINNERS.</SectionHeading>
        <SectionIntro>
          Awarded recipients and available work previews, ranked by the task&rsquo;s result.
        </SectionIntro>
        <ul className="mt-6 grid list-none gap-3 p-0">
          {tasks
            .filter((task) => task.winners.length > 0)
            .map((task) => (
              <WinnerRow isPreviewFixture={isPreviewFixture} key={task.id} task={task} />
            ))}
        </ul>
      </div>
    </section>
  ) : null;
  const alertsSection = (
    <section
      className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-13 sm:px-6 lg:px-8"
      id="drop-alerts"
    >
      <Kicker>NEVER MISS ONE</Kicker>
      <SectionHeading>
        {drop.isOfficial ? 'GET OFFICIAL DROPS.' : 'FOLLOW THIS DROP.'}
      </SectionHeading>
      <SectionIntro>
        {drop.isOfficial
          ? 'One email when each new official Task Drop opens.'
          : `Get an email when new tasks are published into ${drop.name}.`}
      </SectionIntro>
      <div className="mt-6 max-w-[420px]">
        <TaskDropSubscribeForm isOfficial={drop.isOfficial} taskDropId={drop.id} />
      </div>
    </section>
  );

  const ordered = sectionOrder(state)
    .map((key) => ({
      key,
      node: {
        alerts: alertsSection,
        enter: enterSection,
        winners: winnersSection,
        work: workSection,
      }[key],
    }))
    .filter((entry) => entry.node !== null);

  return (
    <div className={`${bebas.variable} taskdrop-theme`}>
      <DropLifecycleRefresh refreshAt={closesAt} />
      <style>{`
        .drop-display {
          font-family: var(--font-drop-display), Impact, sans-serif;
          font-weight: 400;
          letter-spacing: 0.02em;
          line-height: 0.96;
        }
      `}</style>

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-drop-hero text-drop-hero-foreground" id="drop-hero">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-9 px-4 py-14 sm:px-6 min-[900px]:flex-row min-[900px]:items-start lg:px-8">
          <div
            aria-hidden="true"
            className="relative size-[132px] shrink-0 overflow-hidden rounded-[18px] bg-drop-cta min-[900px]:size-[188px]"
          >
            <img
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              src="/taskdrop/taskdrop-mark-loop-poster.jpg"
            />
            <video
              autoPlay
              className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
              loop
              muted
              playsInline
            >
              <source src="/taskdrop/taskdrop-mark-loop.mp4" type="video/mp4" />
            </video>
          </div>

          <div className="min-w-0 flex-1">
            <p className="drop-display m-0 mb-3 text-[26px] tracking-[0.26em] text-drop-kicker min-[900px]:text-[30px]">
              TASK DROP
            </p>
            <div className="mb-4 h-[1.5px] max-w-[520px] bg-drop-hero-foreground/28" />
            <h1 className="drop-display m-0 text-[42px] text-drop-hero-foreground text-balance min-[900px]:text-[60px]">
              {drop.name}
            </h1>

            <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.45] min-[900px]:text-[18px]">
              {state === 'live' ? (
                <>
                  <span className="font-medium">
                    {counts.accepting} {counts.accepting === 1 ? 'task' : 'tasks'} open.
                  </span>{' '}
                  Closes in{' '}
                  <DropClock className="drop-display text-[20px] tabular-nums" source={closesAt} />.
                </>
              ) : (
                support
              )}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <span
                className={`drop-display inline-flex items-center gap-2.5 rounded-full px-4 pt-2 pb-1.5 text-[17px] tracking-[0.15em] ${
                  state === 'live'
                    ? 'bg-drop-accent text-drop-accent-foreground'
                    : state === 'upcoming'
                      ? 'bg-drop-cta text-drop-cta-foreground'
                      : 'border-[1.5px] border-drop-hero-foreground/50 text-drop-hero-foreground'
                }`}
              >
                {state === 'live' ? (
                  <span className="size-2 rounded-full bg-drop-accent-foreground motion-safe:animate-pulse" />
                ) : null}
                {statePill(state, counts.accepting)}
              </span>
            </div>

            {drop.description ? (
              <p className="mt-3.5 line-clamp-2 max-w-[60ch] text-[15px] leading-[1.5] opacity-90">
                {drop.description}
              </p>
            ) : null}

            <p className="mt-4 m-0 text-[14px] text-drop-hero-foreground/90">
              {drop.isOfficial
                ? 'An official drop from Taskmarket'
                : 'Posted by a market requester'}
              <span className="mt-1 block font-mono text-[11.5px] break-all opacity-60 select-all">
                {drop.isOfficial ? drop.officialWalletAddress : drop.ownerAddress}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* ── numbers ──────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-7 sm:px-6 lg:px-8">
        <dl
          aria-label="Task Drop summary"
          className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/64 bg-surface/44 sm:grid-cols-4"
        >
          {[
            { label: 'Entries', value: state === 'upcoming' ? '-' : String(entries) },
            { label: 'Tasks', value: tasks.length === 0 ? '-' : String(tasks.length) },
            {
              label: 'Prize pool',
              value:
                tasks.length === 0
                  ? '-'
                  : formatUsdcUnits(sumUsdcBaseUnits(tasks.map((task) => task.reward))),
            },
            fourthStat,
          ].map((stat, index) => (
            <div
              className={`grid gap-1.5 p-4 ${
                index < 2 ? 'border-b border-border/58 sm:border-b-0' : ''
              } ${index === 3 ? '' : 'sm:border-r sm:border-border/58'}`}
              key={stat.label}
            >
              <dt className="m-0 font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                {stat.label}
              </dt>
              <dd
                aria-live={index === 3 ? 'off' : undefined}
                className="drop-display m-0 text-[27px] text-foreground"
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {ordered.map((entry) => (
        <Fragment key={entry.key}>{entry.node}</Fragment>
      ))}

      {/* ── disclaimer ───────────────────────────────────────────────────── */}
      <section className="bg-drop-footer px-4 py-9 text-center sm:px-6">
        <p className="mx-auto m-0 max-w-[70ch] text-[12.5px] leading-[1.6] text-drop-footer-muted">
          <Display className="mb-1.5 block text-[13px] tracking-[0.18em] text-drop-kicker">
            DISCLAIMER
          </Display>
          Task Drops are run for entertainment: enter at your own discretion. Each task&rsquo;s
          reward, window and judge are shown on the task itself. Judging is at the judge&rsquo;s
          discretion and acceptance decisions are final.
        </p>
      </section>
    </div>
  );
}
