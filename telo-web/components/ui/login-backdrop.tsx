'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Login backdrop — a PS3 XMB-style flowing ribbon: a few layered translucent
 * wave surfaces drawn additively so their overlaps glow, each edge traced with
 * a soft highlight line, plus slowly rising sparkle motes. No pointer
 * interaction — it just undulates, slow and graceful. Purely decorative:
 * click-through, aria-hidden, never prints.
 *
 * Kept light on purpose: one requestAnimationFrame loop draws straight to a
 * single 2D canvas (no React re-renders per frame), the loop pauses while the
 * tab is hidden, and under `prefers-reduced-motion` it renders one static
 * frame and never animates.
 */

// ── Ribbon layers ─────────────────────────────────────────────────────────────
// Each layer is a filled band: a top edge built from two superposed traveling
// waves, and a bottom edge that breathes (its own phase) so the band's
// thickness swells and folds like fabric. Amplitudes/thickness are fractions
// of the viewport height so the ribbon scales with the window.
type Layer = {
  base: number; // band centreline, fraction of height
  amp1: number; // primary wave amplitude, fraction of height
  amp2: number; // secondary wave amplitude
  f1: number; // primary cycles across the viewport
  f2: number;
  s1: number; // primary speed (rad/s) — slow, XMB-like
  s2: number;
  thick: number; // band thickness, fraction of height
  alpha: number; // fill opacity (additive, so overlaps brighten)
};

const LAYERS: Layer[] = [
  { base: 0.46, amp1: 0.075, amp2: 0.028, f1: 1.1, f2: 2.3, s1: 0.21, s2: -0.31, thick: 0.1, alpha: 0.08 },
  { base: 0.5, amp1: 0.06, amp2: 0.032, f1: 1.4, f2: 2.0, s1: -0.17, s2: 0.26, thick: 0.075, alpha: 0.1 },
  { base: 0.55, amp1: 0.068, amp2: 0.024, f1: 0.9, f2: 2.6, s1: 0.14, s2: 0.33, thick: 0.12, alpha: 0.06 },
  { base: 0.5, amp1: 0.088, amp2: 0.02, f1: 1.25, f2: 1.7, s1: -0.11, s2: -0.24, thick: 0.05, alpha: 0.12 },
];

const SAMPLES = 72; // points per edge — smooth curve, cheap to redraw

// ── Sparkle motes ─────────────────────────────────────────────────────────────
const MOTES = 56;

type Mote = {
  x: number; // 0..1 of width
  y: number; // 0..1 of height
  r: number; // radius px
  depth: number; // 0..1 — drives alpha
  vy: number; // upward drift, fraction of height per second
  tw: number; // twinkle phase
};

/** Deterministic pseudo-random (seeded) so SSR/first paint never flashes. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMotes(): Mote[] {
  const rand = mulberry32(7);
  return Array.from({ length: MOTES }, () => ({
    x: rand(),
    // Bias motes toward the ribbon band (vertical centre) like the XMB dust.
    y: 0.5 + (rand() - 0.5) * 0.9,
    r: 0.6 + rand() * 1.6,
    depth: 0.25 + rand() * 0.75,
    vy: 0.004 + rand() * 0.012,
    tw: rand() * Math.PI * 2,
  }));
}

/** Reads a `--var: H S% L%` theme token and returns an `hsl(... / a)` maker.
 *  `lift` raises the lightness (percentage points) — the theme's primary is a
 *  deep indigo that all but vanishes at ribbon alphas, so the ribbon draws a
 *  brighter tint of the same hue. */
function themeColor(varName: string, lift = 0) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(raw);
  if (!m) return (alpha: number) => `hsl(${raw} / ${alpha})`;
  const l = Math.min(90, parseFloat(m[3]) + lift);
  return (alpha: number) => `hsl(${m[1]} ${m[2]}% ${l}% / ${alpha})`;
}

export function LoginBackdrop({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const primary = themeColor('--primary', 22);
    const secondary = themeColor('--secondary', 10);

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const motes = makeMotes();

    /** Top-edge y for layer `L` at horizontal position `u` (0..1). */
    const edgeY = (L: Layer, u: number, t: number) =>
      h *
      (L.base +
        L.amp1 * Math.sin(u * L.f1 * 2 * Math.PI - t * L.s1) +
        L.amp2 * Math.sin(u * L.f2 * 2 * Math.PI - t * L.s2 + 1.3));

    /** The band's thickness at `u` — breathes with its own slow phase so the
     *  ribbon folds and swells instead of staying a constant-width strip. */
    const thickness = (L: Layer, u: number, t: number) =>
      h * L.thick * (0.6 + 0.4 * Math.sin(u * 2.2 * 2 * Math.PI + t * 0.19 + 2.1));

    const drawFrame = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // Ribbon — additive blending so layer overlaps bloom like the XMB wave.
      ctx.globalCompositeOperation = 'lighter';

      const fill = ctx.createLinearGradient(0, 0, w, 0);
      fill.addColorStop(0, primary(0));
      fill.addColorStop(0.22, primary(1));
      fill.addColorStop(0.6, secondary(0.85));
      fill.addColorStop(1, secondary(0));

      for (const L of LAYERS) {
        // Band: top edge left→right, bottom edge right→left, closed + filled.
        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const u = s / SAMPLES;
          const y = edgeY(L, u, t);
          if (s === 0) ctx.moveTo(0, y);
          else ctx.lineTo(u * w, y);
        }
        for (let s = SAMPLES; s >= 0; s--) {
          const u = s / SAMPLES;
          ctx.lineTo(u * w, edgeY(L, u, t) + thickness(L, u, t));
        }
        ctx.closePath();
        ctx.globalAlpha = L.alpha;
        ctx.fillStyle = fill;
        ctx.fill();

        // Soft highlight along the top edge — the ribbon's silk sheen.
        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const u = s / SAMPLES;
          const y = edgeY(L, u, t);
          if (s === 0) ctx.moveTo(0, y);
          else ctx.lineTo(u * w, y);
        }
        ctx.globalAlpha = Math.min(0.55, L.alpha * 4.5);
        ctx.strokeStyle = fill;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // Sparkle motes — rising slowly, twinkling.
      for (const m of motes) {
        const y = (((m.y - t * m.vy) % 1) + 1) % 1;
        const twinkle = 0.55 + 0.45 * Math.sin(t * 1.4 + m.tw);
        ctx.beginPath();
        ctx.arc(m.x * w, y * h, m.r, 0, Math.PI * 2);
        ctx.fillStyle =
          m.depth > 0.6
            ? primary(0.32 * m.depth * twinkle)
            : `rgba(255,255,255,${(0.22 * m.depth * twinkle).toFixed(3)})`;
        ctx.fill();
      }
    };

    if (reduceMotion) {
      drawFrame(0);
      const onResize = () => {
        resize();
        drawFrame(0);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let raf = 0;
    let startedAt = performance.now();

    const frame = (now: number) => {
      drawFrame((now - startedAt) / 1000);
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => resize();
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
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden print:hidden',
        // Fade toward the edges so the ribbon reads as texture, not a hard band.
        '[mask-image:radial-gradient(ellipse_120%_85%_at_center,black_45%,transparent_92%)]',
        className,
      )}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
