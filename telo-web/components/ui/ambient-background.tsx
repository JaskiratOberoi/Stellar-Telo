import { cn } from '@/lib/utils';

/**
 * Decorative ambient background — three slowly drifting colour blobs over a
 * faded dotted grid, anchored by a bottom vignette. Click-through and
 * aria-hidden; motion pauses under `prefers-reduced-motion`. Never prints.
 *
 * - `subtle` dials the blob opacity right down for content-dense portal
 *   screens, where it should read as texture rather than decoration.
 * - Pass `className="fixed"` to pin it behind scrolling page content (the
 *   default `absolute inset-0` fills its nearest positioned ancestor).
 */
export function AmbientBackground({
  className,
  subtle = false,
}: {
  className?: string;
  subtle?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden print:hidden',
        className,
      )}
    >
      <div
        className={cn(
          'absolute -left-40 -top-40 h-[40rem] w-[40rem] animate-blob rounded-full blur-[130px] motion-reduce:animate-none',
          subtle ? 'bg-primary/10' : 'bg-primary/30',
        )}
      />
      <div
        className={cn(
          'absolute -right-48 top-1/4 h-[34rem] w-[34rem] animate-blob rounded-full blur-[130px] [animation-delay:-6s] motion-reduce:animate-none',
          subtle ? 'bg-secondary/10' : 'bg-secondary/20',
        )}
      />
      <div
        className={cn(
          'absolute -bottom-48 left-1/3 h-[36rem] w-[36rem] animate-blob rounded-full blur-[140px] [animation-delay:-12s] motion-reduce:animate-none',
          subtle ? 'bg-chart-5/10' : 'bg-chart-5/25',
        )}
      />
      {/* Fine dotted grid, faded toward the edges. Dots key off --foreground so
          they're light-on-dark in dark mode and dark-on-light in light mode. */}
      <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,hsl(var(--foreground)/0.05)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      {/* Vignette to anchor content */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/80" />
    </div>
  );
}
