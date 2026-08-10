import { cn } from '@/lib/utils';

/**
 * Noble Diagnostics' ring mark — the woven circle from the brand lockup.
 *
 * The shipped logos (public/branding/noble-logo*.png) are all full lockups
 * (ring + wordmark) on an OPAQUE near-white background, so none could be used
 * directly beside the Telo wordmark. `noble-mark.png` is the ring cut out of
 * noble-logo.png at its measured bounds (x 2..104, y 4..105 → 103x102) with
 * the white keyed out via luminance-derived alpha, which keeps the woven
 * edges anti-aliased. Regenerate with db/scripts/_make-noble-mark.mjs.
 *
 * The mark is brand navy, which would disappear on the dark theme's near-black
 * surfaces — `brightness(0) invert(1)` repaints any opaque pixel white there
 * while preserving the alpha, so one asset serves both themes.
 */
export function NobleMark({ className }: { className?: string }) {
  return (
    // Plain <img>: a fixed-size, already-tiny static asset gains nothing from
    // next/image's resizing pipeline, and intrinsic width/height keep it from
    // shifting layout while it loads.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/branding/noble-mark.png"
      alt=""
      aria-hidden
      width={103}
      height={102}
      className={cn(
        'shrink-0 select-none dark:[filter:brightness(0)_invert(1)]',
        className,
      )}
    />
  );
}
