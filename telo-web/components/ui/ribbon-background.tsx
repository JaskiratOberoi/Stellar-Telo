'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Decorative animated ribbon — a band of thin wave-lines that genuinely
 * undulate: the path shape morphs over time (a traveling wave) rather than a
 * static image sliding across. Purely decorative, click-through, aria-hidden,
 * never prints.
 *
 * Kept light on purpose: one requestAnimationFrame loop updates ~16 SVG paths
 * imperatively (via refs — no React re-render per frame), there's no canvas /
 * WebGL, the loop pauses while the tab is hidden, and under
 * `prefers-reduced-motion` it renders a single static frame and never animates.
 */

// ── Geometry (SVG user units; stretched to fill via preserveAspectRatio) ──────
const W = 1000;
const H = 600;
const LINES = 16;
const POINTS = 44; // samples per line — enough for a smooth curve, cheap to redraw
const BAND_TOP = 188;
const BAND_BOTTOM = 412;
const GAP = (BAND_BOTTOM - BAND_TOP) / (LINES - 1);

// Two superposed traveling waves (different spatial frequency, speed and
// direction) so the ribbon morphs organically instead of rigidly translating.
const A1 = 34; // primary amplitude
const A2 = 15; // secondary amplitude
const FREQ1 = 1.5; // cycles across the tile
const FREQ2 = 2.7;
const SPEED1 = 0.85; // rad/s
const SPEED2 = -0.55; // opposite direction → shifting interference
const LINE_PHASE = 0.4; // per-line phase offset → soft woven look

/** Builds one line's `d` for a given time `t` (seconds). Pure + deterministic
 *  so the SSR frame and the client's first frame match (no hydration flash). */
function buildLine(i: number, t: number): string {
  const baseY = BAND_TOP + i * GAP;
  const ph = i * LINE_PHASE;
  const pts: string[] = [];
  for (let s = 0; s <= POINTS; s++) {
    const x = (s / POINTS) * W;
    const u = x / W;
    const y =
      baseY +
      A1 * Math.sin(u * FREQ1 * 2 * Math.PI - t * SPEED1 + ph) +
      A2 * Math.sin(u * FREQ2 * 2 * Math.PI - t * SPEED2 + ph * 1.7);
    pts.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

// Static first frame (t=0) — rendered on the server and as the client's initial
// markup, then animated in place by the rAF loop below.
const INITIAL_PATHS = Array.from({ length: LINES }, (_, i) => buildLine(i, 0));

export function RibbonBackground({ className }: { className?: string }) {
  const paths = useRef<Array<SVGPathElement | null>>([]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return; // honour reduced motion: keep the static first frame
    }

    let raf = 0;
    let startedAt = performance.now();

    const frame = (now: number) => {
      const t = (now - startedAt) / 1000;
      for (let i = 0; i < paths.current.length; i++) {
        paths.current[i]?.setAttribute('d', buildLine(i, t));
      }
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        startedAt = performance.now() - 0; // resume from current shape
        raf = requestAnimationFrame(frame);
      }
    };

    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden opacity-70 print:hidden',
        // Fade toward the edges so the ribbon reads as texture, not a hard band.
        '[mask-image:radial-gradient(ellipse_115%_75%_at_center,black_42%,transparent_88%)]',
        className,
      )}
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          <linearGradient id="ribbon-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="30%" stopColor="hsl(var(--primary))" stopOpacity="0.55" />
            <stop offset="60%" stopColor="hsl(var(--secondary))" stopOpacity="0.5" />
            <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="url(#ribbon-stroke)" strokeWidth="1" strokeLinecap="round">
          {INITIAL_PATHS.map((d, i) => (
            <path
              key={i}
              ref={(el) => {
                paths.current[i] = el;
              }}
              d={d}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
