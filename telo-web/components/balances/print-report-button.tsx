'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Calls window.print(). Unlike the receipt-page print buttons, this report
 * page has only one print view, so no mode-class needed — the default
 * @media print rules + the page's `print:hidden` / `hidden print:block`
 * wrappers do the right thing on their own.
 */
export function PrintReportButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => window.print()}
    >
      <Printer className="h-3.5 w-3.5" />
      Print report
    </Button>
  );
}
