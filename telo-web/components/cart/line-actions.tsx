'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
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
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() =>
        start(async () => {
          await removeFromCart(id, kind);
          router.refresh();
        })
      }
    >
      <X className="h-3.5 w-3.5" aria-hidden />
      {pending ? 'Removing…' : 'Remove'}
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
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() =>
        start(async () => {
          await clearMyCart();
          router.refresh();
        })
      }
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
      {pending ? 'Clearing…' : 'Clear cart'}
    </Button>
  );
}
