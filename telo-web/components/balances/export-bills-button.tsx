'use client';

import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtIST } from '@/lib/datetime';

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

function ageLabel(age: number | null, ageType: number | null): string {
  if (age == null) return '';
  const unit = ageType === 2 ? 'M' : ageType === 3 ? 'D' : 'Y';
  return `${age}${unit}`;
}

/** Escape a CSV cell (quote when it contains a comma, quote or newline). */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export the (currently filtered) accounts bills to a CSV file that Excel opens
 * and edits natively — for mass corrections. Amounts are written as raw numbers
 * (no ₹/thousands separators) so they stay numeric/editable; a UTF-8 BOM keeps
 * patient names and symbols intact. Purely client-side download; no server call,
 * no data mutation.
 */
export function ExportBillsButton({
  bills,
  fileName,
}: {
  bills: ExportBill[];
  fileName: string;
}) {
  function onExport() {
    const headers = [
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
    ];
    const rows = bills.map((b) => [
      b.billNumber ?? b.billId,
      b.billDate ? fmtIST(b.billDate, 'date') : '',
      b.patientName ?? '',
      b.patientId ?? '',
      b.doctorName ?? '',
      b.customerName ?? '',
      b.paymentType ?? '',
      ageLabel(b.age, b.ageType),
      b.amount,
      b.discount,
      b.amountPaid,
      b.balance,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n');
    // Prepend a UTF-8 BOM so Excel decodes names/symbols correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onExport}
      disabled={bills.length === 0}
      title={bills.length === 0 ? 'No bills to export' : 'Download an editable spreadsheet'}
    >
      <FileSpreadsheet className="h-3.5 w-3.5" />
      Export Excel
    </Button>
  );
}
