/**
 * Generic loading skeleton for route-level `loading.tsx` files. Renders a
 * title placeholder + a column of card-shaped pulse blocks so the layout
 * doesn't jump on stream-in. Tune via `cards` / `cardHeight`.
 */
export function PageSkeleton({
  title = true,
  cards = 1,
  cardHeight = 'h-72',
}: {
  title?: boolean;
  cards?: number;
  cardHeight?: string;
}) {
  return (
    <div className="space-y-4">
      {title && (
        <div className="space-y-1.5">
          <div className="h-6 w-44 animate-pulse rounded bg-foreground/5" />
          <div className="h-3 w-72 animate-pulse rounded bg-foreground/5" />
        </div>
      )}
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className={`${cardHeight} w-full animate-pulse rounded-lg border border-foreground/5 bg-card/50`}
        />
      ))}
    </div>
  );
}
