'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addToCart } from '@/actions/cart.actions';
import { Button } from '@/components/ui/button';
import type { CartItem } from '@/domain/cart/cart.types';

/**
 * Fly a small chip from `source` to the nav element marked
 * `data-cart-target`. Visual feedback only — has no functional effect.
 * Silently no-ops if the target isn't in the DOM (e.g. for users without
 * `order:view`, the "New order" link isn't rendered).
 */
function flyToCart(source: HTMLElement, label: string) {
  const target = document.querySelector<HTMLElement>('[data-cart-target]');
  if (!target) return;

  const start = source.getBoundingClientRect();
  const end = target.getBoundingClientRect();

  const chip = document.createElement('div');
  chip.textContent = label;
  // Inline styles (not Tailwind) — we attach to document.body which isn't
  // inside the React tree, so the class won't be JIT-purged on next build.
  Object.assign(chip.style, {
    position: 'fixed',
    left: `${start.left + start.width / 2}px`,
    top: `${start.top + start.height / 2}px`,
    transform: 'translate(-50%, -50%) scale(1)',
    padding: '4px 10px',
    borderRadius: '9999px',
    background: '#C69E6A', // secondary (tan)
    color: '#0F0F0F',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    fontWeight: '700',
    pointerEvents: 'none',
    zIndex: '1000',
    boxShadow: '0 8px 24px -8px rgba(198, 158, 106, 0.5)',
    transition:
      'left 700ms cubic-bezier(0.4, 0, 0.2, 1),' +
      'top 700ms cubic-bezier(0.4, 0, 0.2, 1),' +
      'transform 700ms cubic-bezier(0.4, 0, 0.2, 1),' +
      'opacity 200ms ease-out 500ms',
  });
  document.body.appendChild(chip);

  // Force layout flush so the initial styles register before we change them.
  void chip.offsetHeight;

  requestAnimationFrame(() => {
    chip.style.left = `${end.left + end.width / 2}px`;
    chip.style.top = `${end.top + end.height / 2}px`;
    chip.style.transform = 'translate(-50%, -50%) scale(0.3)';
    chip.style.opacity = '0';
  });

  // After the chip arrives, pulse the nav target so the badge bump feels
  // earned, then clean up.
  window.setTimeout(() => {
    target.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.15)' },
        { transform: 'scale(1)' },
      ],
      { duration: 300, easing: 'ease-out' },
    );
    chip.remove();
  }, 720);
}

export function AddToCartButton({ item }: { item: CartItem }) {
  const [pending, start] = useTransition();
  const [added, setAdded] = useState(false);
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant={added ? 'secondary' : 'outline'}
      disabled={pending || added}
      onClick={(e) => {
        // Fire the animation synchronously off the click so the user sees
        // immediate feedback even while the server action is in flight.
        flyToCart(e.currentTarget, item.code);
        start(async () => {
          const r = await addToCart(item);
          if (r.ok) {
            setAdded(true);
            // Refresh the layout so the nav badge picks up the new count
            // (timed just past the chip's arrival so they land together).
            window.setTimeout(() => router.refresh(), 650);
          }
        });
      }}
    >
      {added ? 'Added' : pending ? '…' : 'Add'}
    </Button>
  );
}
