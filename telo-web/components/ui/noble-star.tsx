import { cn } from '@/lib/utils';

/**
 * Noble's four-point sparkle — the star from the Noble Diagnostics mark
 * (public/branding/noble-logo-onlight.png), redrawn as a path.
 *
 * Inline SVG rather than a crop of the PNG: it stays crisp at any size, costs
 * no extra request, can't shift layout while loading, and inherits the current
 * text colour so it follows the brand token in both themes (the PNG comes in
 * fixed light/dark variants).
 *
 * Concave edges give the elongated "sparkle" silhouette of the original —
 * taller than it is wide, with the waist pinched in toward the centre.
 */
export function NobleStar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cn('shrink-0', className)}
      fill="currentColor"
    >
      <path d="M12 0c.62 8.05 3.02 11.42 7.6 12-4.58.58-6.98 3.95-7.6 12-.62-8.05-3.02-11.42-7.6-12 4.58-.58 6.98-3.95 7.6-12z" />
    </svg>
  );
}
