import { cn } from '@/lib/utils';

/**
 * Decorative aurora backdrop — two slow-drifting gradient fields (indigo →
 * violet, teal) over a fine dotted grid, anchored by a bottom vignette.
 * Click-through and aria-hidden; motion pauses under `prefers-reduced-motion`.
 * Never prints.
 *
 * - `subtle` dials the field opacity right down for content-dense portal
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
      {/* Aurora field 1 — brand indigo → violet, sweeping from the top left. */}
      <div
        className={cn(
          'absolute -left-[20%] -top-[30%] h-[80vh] w-[90vw] animate-aurora rounded-[100%] motion-reduce:animate-none',
          'blur-[110px]',
          subtle ? 'opacity-[0.13] dark:opacity-[0.16]' : 'opacity-[0.32] dark:opacity-[0.38]',
        )}
        style={{
          background:
            'radial-gradient(closest-side, hsl(var(--primary)) 0%, hsl(var(--brand-2) / 0.8) 55%, transparent 100%)',
        }}
      />
      {/* Aurora field 2 — teal counterweight, rising from the bottom right. */}
      <div
        className={cn(
          'absolute -bottom-[35%] -right-[25%] h-[75vh] w-[80vw] animate-aurora rounded-[100%] [animation-delay:-12s] motion-reduce:animate-none',
          'blur-[120px]',
          subtle ? 'opacity-[0.10] dark:opacity-[0.12]' : 'opacity-[0.26] dark:opacity-[0.3]',
        )}
        style={{
          background:
            'radial-gradient(closest-side, hsl(var(--secondary)) 0%, hsl(var(--primary) / 0.5) 60%, transparent 100%)',
        }}
      />
      {/* Fine dotted grid, faded toward the edges. Dots key off --foreground so
          they're light-on-dark in dark mode and dark-on-light in light mode. */}
      <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,hsl(var(--foreground)/0.05)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      {/* Vignette to anchor content */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/80" />
    </div>
  );
}
