'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Above this many bills, laying out the print view is slow enough that the
 *  tab looks hung — warn first rather than freezing without explanation. */
const PRINT_WARN_ROWS = 1500;

/**
 * Calls window.print(). Unlike the receipt-page print buttons, this report
 * page has only one print view, so no mode-class needed — the default
 * @media print rules + the page's `print:hidden` / `hidden print:block`
 * wrappers do the right thing on their own.
 *
 * The account summary is uncapped by design (its totals must cover every bill
 * in the period), so a wide range on a busy client can put thousands of rows
 * in the print layout — which is what makes the tab appear to hang. We do not
 * silently trim a financial document; instead a large print is confirmed
 * first, so the wait is expected rather than mysterious.
 */
export function PrintReportButton({
  rowCount = 0,
  printHref,
}: {
  rowCount?: number;
  /** URL of the full-statement view (?print=1), which loads every bill in the
   *  period and opens the dialog itself. */
  printHref: string;
}) {
  function onPrint() {
    if (
      rowCount > PRINT_WARN_ROWS &&
      !window.confirm(
        `This report has ${rowCount.toLocaleString('en-IN')} bills. ` +
          `Preparing that many rows for print can take a while and the tab may ` +
          `be unresponsive meanwhile.\n\nPrint anyway? ` +
          `(Tip: narrow the date range for a faster, more readable report.)`,
      )
    ) {
      return;
    }
    // Open the complete statement in its own tab; it prints on load. The
    // screen view only holds one page, so printing it directly would produce
    // a partial statement.
    window.open(printHref, '_blank', 'noopener');
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onPrint}
    >
      <Printer className="h-3.5 w-3.5" />
      Print report
    </Button>
  );
}
