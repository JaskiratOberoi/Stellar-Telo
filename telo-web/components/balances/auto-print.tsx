'use client';

import { useEffect } from 'react';

/**
 * Fires the print dialog once the statement has rendered.
 *
 * The account page is server-paginated, so `?print=1` renders a separate,
 * unpaginated view holding every bill in the period. Printing is triggered
 * here rather than by the button so the dialog opens against the COMPLETE
 * statement — the old flow called window.print() on the paged screen view,
 * which is both slow and (now) incomplete.
 *
 * A double rAF lets the browser finish layout of a potentially large table
 * before the dialog blocks the main thread.
 */
export function AutoPrint() {
  useEffect(() => {
    let cancelled = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
