import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * The shape of an order card before its data arrives: same height, same
 * columns, so nothing moves when the real card replaces it. Never a spinner
 * on its own.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block ${ui.skeleton} ${className}`} />;
}

export function OrderCardSkeleton() {
  return (
    <div aria-hidden="true" className={`${ui.card} flex flex-col gap-4 p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-28" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        </div>
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-6 w-4/5" />
      <Skeleton className="h-6 w-3/5" />
      <Skeleton className="h-6 w-2/3" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-14 flex-1" />
        <Skeleton className="h-14 w-28" />
      </div>
    </div>
  );
}
