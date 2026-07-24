import { Skeleton } from '@/components/ui/skeleton';

const taskCards = ['task-1', 'task-2', 'task-3', 'task-4'];

export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading Task Drop"
      className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      role="status"
    >
      <span className="sr-only">Loading Task Drop</span>
      <div className="grid gap-4 rounded-xl border border-border/64 p-6 sm:p-8">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-12 w-2/3 max-w-xl" />
        <Skeleton className="h-5 w-full max-w-2xl" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/64 sm:grid-cols-4">
        {['summary-1', 'summary-2', 'summary-3', 'summary-4'].map((item) => (
          <div className="grid gap-2 bg-surface/44 p-4" key={item}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4 lg:col-start-2 lg:row-start-1">
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <div className="grid gap-5 lg:col-start-1 lg:row-start-1">
          <Skeleton className="h-9 w-52" />
          <div className="grid gap-4 md:grid-cols-2">
            {taskCards.map((item) => (
              <Skeleton className="h-52 w-full rounded-xl" key={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
