'use client';

import { useTransition, useState } from 'react';
import { addToCart } from '@/actions/cart.actions';
import { Button } from '@/components/ui/button';
import type { CartItem } from '@/domain/cart/cart.types';

export function AddToCartButton({ item }: { item: CartItem }) {
  const [pending, start] = useTransition();
  const [added, setAdded] = useState(false);

  return (
    <Button
      size="sm"
      variant={added ? 'secondary' : 'outline'}
      disabled={pending || added}
      onClick={() =>
        start(async () => {
          const r = await addToCart(item);
          if (r.ok) setAdded(true);
        })
      }
    >
      {added ? 'Added' : pending ? '…' : 'Add'}
    </Button>
  );
}
