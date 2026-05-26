'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Adds `print-lab` or `print-bill` to <html> before calling window.print(),
 * then removes it. The @media print block in globals.css uses these classes
 * to show only the relevant invoice layout.
 */
function printMode(mode: 'lab' | 'bill') {
  document.documentElement.classList.add(`print-${mode}`);
  window.print();
  document.documentElement.classList.remove(`print-${mode}`);
}

export function PrintLabButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => printMode('lab')}
    >
      <Printer className="h-3.5 w-3.5" />
      Lab receipt
    </Button>
  );
}

export function PrintBillButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => printMode('bill')}
    >
      <Printer className="h-3.5 w-3.5" />
      Bill
    </Button>
  );
}
