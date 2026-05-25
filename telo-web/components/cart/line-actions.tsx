'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeFromCart, clearMyCart } from '@/actions/cart.actions';
import { Button } from '@/components/ui/button';
import type { CatalogKind } from '@/domain/catalog/catalog.types';

export function RemoveLineButton({
  id,
  kind,
}: {
  id: number;
  kind: CatalogKind;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeFromCart(id, kind);
          router.refresh();
        })
      }
    >
      Remove
    </Button>
  );
}

export function ClearCartButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await clearMyCart();
          router.refresh();
        })
      }
    >
      Clear cart
    </Button>
  );
}
