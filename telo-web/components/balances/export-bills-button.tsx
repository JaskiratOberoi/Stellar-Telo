'use client';

import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { SheetData } from 'write-excel-file/browser';
import { Button } from '@/components/ui/button';
import { fmtIST } from '@/lib/datetime';
import { getBillsForExport } from '@/actions/ledger.actions';

/** The bill fields exported to the spreadsheet (a structural subset of the
 *  ledger's PendingBillRow — kept local so this client component never imports
 *  the server-only ledger module). */
export interface ExportBill {
  billId: number;
  billNumber: number | null;
  billDate: string | null;
  patientName: string | null;
  patientId: number | null;
  doctorName: string | null;
  customerName: string | null;
  paymentType: string | null;
  age: number | null;
  ageType: number | null;
  amount: number;
  discount: number;
  amountPaid: number;
  balance: number;
}

/** Minimal receipt shape for the export — the bill's payment/refund txn ids
 *  plus the operator-entered payment reference (UPI UTR / card ref / cheque no)
 *  captured for non-cash payments. */
export interface ExportReceipt {
  txnId: string | null;
  /** Payment mode the operator picked ('Cash' / 'UPI' / 'Card' / …). */
  method: string | null;
  /** Operator-entered reference (card_number) — present for non-cash payments. */
  reference: string | null;
  kind: 'payment' | 'refund';
}

function ageLabel(age: number | null, ageType: number | null): string {
  if (age == null) return '';
  const unit = ageType === 2 ? 'M' : ageType === 3 ? 'D' : 'Y';
  return `${age}${unit}`;
}

const HEADERS = [
  'Bill #',
  'Date',
  'Patient',
  'PID',
  'Ref. Doctor',
  'Ref. Customer',
  'Payment',
  'Age',
  'Amount',
  'Discount',
  'Paid',
  'Balance',
  'Txn ID(s)',
  'Payment Ref',
];

const COLUMN_WIDTHS = [12, 11, 26, 11, 22, 18, 10, 7, 11, 11, 11, 11, 24, 24];

/** Rows built per slice before handing the main thread back to the browser. */
const CHUNK = 400;

/** Resolve after the browser has had a chance to paint. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * `Array.map` that yields between slices, so building tens of thousands of
 * styled cell objects doesn't lock the tab. A busy client can hold thousands
 * of bills in one period (MDCARE: ~5.7k year-to-date) x 14 cells each, and
 * doing that in one synchronous pass is what made the tab stop responding.
 */
async function mapInChunks<T, R>(
  items: T[],
  fn: (item: T) => R,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    for (const item of items.slice(i, i + CHUNK)) out.push(fn(item));
    if (i + CHUNK < items.length) await nextFrame();
  }
  return out;
}

/**
 * Export the (currently filtered) accounts bills to a real .xlsx workbook for
 * mass corrections — amounts as raw numbers (editable/summable), one row per
 * bill with its payment txn ids. The xlsx writer is dynamically imported so it
 * only loads when the button is clicked (no impact on the rest of the bundle).
 * Fetches the full matching set through getBillsForExport on click (the page
 * itself is paginated), then builds the workbook client-side. Read-only — no
 * data mutation.
 */
export function ExportBillsButton({
  mccId,
  from,
  to,
  mine,
  q,
  rowCount,
  fileName,
}: {
  /** The account page's active filters — replayed server-side to fetch the
   *  FULL matching set. The summary is server-paginated, so exporting the
   *  rendered rows would silently ship a partial workbook. */
  mccId: number;
  from: string;
  to: string;
  mine?: boolean;
  q?: string;
  /** Total matching bills — for the disabled state and the button title. */
  rowCount: number;
  fileName: string;
}) {
  const [busy, setBusy] = useState(false);

  async function onExport() {
    if (busy || rowCount === 0) return;
    setBusy(true);
    try {
      // Pull every matching bill (one round-trip), then build in slices.
      const { bills, receiptsByBill } = await getBillsForExport(mccId, {
        from,
        to,
        mine,
        q,
      });
      if (bills.length === 0) return;
      // Let React paint "Exporting…" BEFORE the heavy work starts. Without this
      // the state update and the blocking build happen in the same frame, so
      // the button never changes and the tab just appears to freeze.
      await nextFrame();

      // Browser build (this is a client component); the package exposes only
      // subpath exports, so import the browser entry explicitly.
      const writeXlsxFile = (await import('write-excel-file/browser')).default;

      const headerRow = HEADERS.map((value) => ({
        value,
        fontWeight: 'bold' as const,
      }));

      const dataRows = await mapInChunks(bills, (b) => {
        // Comma-join the bill's txn ids; tag refunds so corrections are clear.
        const txnIds = (receiptsByBill?.[b.billId] ?? [])
          .filter((t) => t.txnId)
          .map((t) => (t.kind === 'refund' ? `${t.txnId} (refund)` : t.txnId))
          .join(', ');
        // Operator-entered references for non-cash payments (Cash has none).
        // Tag refunds so a returned UTR/cheque is clear in a correction sheet.
        const paymentRefs = (receiptsByBill?.[b.billId] ?? [])
          .filter((t) => t.reference)
          .map((t) => (t.kind === 'refund' ? `${t.reference} (refund)` : t.reference))
          .join(', ');
        // Row shading by balance: negative (refund due) → light red,
        // positive (payment due) → light yellow, settled (0) → no fill.
        const rowFill =
          b.balance < 0
            ? { backgroundColor: '#FFD6D6' as const }
            : b.balance > 0
              ? { backgroundColor: '#FFF3C4' as const }
              : {};
        return [
          { type: Number, value: b.billNumber ?? b.billId, ...rowFill },
          { type: String, value: b.billDate ? fmtIST(b.billDate, 'date') : '', ...rowFill },
          { type: String, value: b.patientName ?? '', ...rowFill },
          { type: Number, value: b.patientId ?? null, ...rowFill },
          { type: String, value: b.doctorName ?? '', ...rowFill },
          { type: String, value: b.customerName ?? '', ...rowFill },
          { type: String, value: b.paymentType ?? '', ...rowFill },
          { type: String, value: ageLabel(b.age, b.ageType), ...rowFill },
          { type: Number, value: b.amount, ...rowFill },
          { type: Number, value: b.discount, ...rowFill },
          { type: Number, value: b.amountPaid, ...rowFill },
          { type: Number, value: b.balance, ...rowFill },
          { type: String, value: txnIds, ...rowFill },
          { type: String, value: paymentRefs, ...rowFill },
        ];
      });

      const data = [headerRow, ...dataRows] as SheetData;
      // v4 API: returns { toFile, toBlob }; toFile() triggers the browser download.
      await writeXlsxFile(data, {
        columns: COLUMN_WIDTHS.map((width) => ({ width })),
      }).toFile(fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onExport}
      disabled={busy || rowCount === 0}
      title={
        rowCount === 0
          ? 'No bills to export'
          : `Download all ${rowCount.toLocaleString('en-IN')} matching bills as an editable Excel workbook`
      }
    >
      <FileSpreadsheet className="h-3.5 w-3.5" />
      {busy ? 'Exporting…' : 'Export Excel'}
    </Button>
  );
}
