import { Skeleton } from '@/components/ui/skeleton';

export default function HooksLoading() {
  return (
    <div className="mx-auto grid max-w-7xl gap-5 px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-5 max-w-xl" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
