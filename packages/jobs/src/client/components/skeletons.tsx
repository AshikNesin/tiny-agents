import { Card } from "@groot/ui/card";
import { Skeleton, SkeletonCard, SkeletonTable } from "@groot/ui/loading-skeleton";
import { cn } from "@groot/ui/lib/utils";

function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}

export function JobsStatsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Card size="sm" className="flex flex-row flex-wrap items-stretch gap-0 p-0">
      {[...Array(count)].map((_, idx) => (
        <div
          key={idx.toString()}
          className={cn(
            "flex min-w-[7rem] flex-1 flex-col gap-2 px-4 py-3",
            idx !== 0 && "border-l border-border/60",
          )}
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-10" />
        </div>
      ))}
    </Card>
  );
}

export function JobsTableSkeleton({ rows = 10 }: { rows?: number }) {
  return <SkeletonTable columns={5} rows={rows} />;
}

export function ScheduledJobsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Card className="gap-0 overflow-hidden p-0">
        <SkeletonTable columns={4} rows={rows} header={false} />
      </Card>
    </div>
  );
}

export function JobDetailSkeleton() {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3 w-48 font-mono" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20 rounded-xl" />
          <Skeleton className="h-9 w-20 rounded-xl" />
        </div>
      </div>
      <div className="mt-8 space-y-6">
        <SkeletonCard titleWidth="w-20">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <FieldSkeleton key={i.toString()} />
            ))}
          </div>
        </SkeletonCard>
        <SkeletonCard titleWidth="w-16">
          <Skeleton className="h-48 w-full" />
        </SkeletonCard>
        <SkeletonCard titleWidth="w-12">
          <Skeleton className="h-40 w-full" />
        </SkeletonCard>
      </div>
    </>
  );
}
