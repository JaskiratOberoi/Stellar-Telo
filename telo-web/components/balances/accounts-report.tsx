/**
 * AccountsReport — printable A4 account statement for one MCC over a date
 * range. Mirrors the visual language of BillInvoice/LabInvoice (hardcoded
 * light colours so it works after the @media print CSS-variable reset).
 *
 * Rendered as `hidden print:block` in the balances page wrapper.
 */

import type { PendingBillRow, BillReceiptRow } from '@/db/read/ledger';
import type { MccInvoiceConfig } from '@/db/read/invoiceConfig';
import type { ReceiptTotals } from '@/db/read/receipts';
import { fmtIST } from '@/lib/datetime';
import { Fragment } from 'react';

interface AccountsReportProps {
  mccName: string | null;
  mccCode: string | null;
  invoiceConfig: MccInvoiceConfig | null;
  from: string;
  to: string;
  bills: PendingBillRow[];
  receiptsByBill: Record<number, BillReceiptRow[]>;
  totalBalance: number;
  /** Receipt-date-keyed cash-flow totals (see db/read/receipts.ts). */
  receipts: ReceiptTotals;
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

export function AccountsReport({
  mccName,
  mccCode,
  invoiceConfig,
  from,
  to,
  bills,
  receiptsByBill,
  totalBalance,
  receipts,
}: AccountsReportProps) {
  const labName =
    invoiceConfig?.labName?.trim() || mccName?.trim() || 'Diagnostic Centre';
  const address = invoiceConfig?.address?.trim() || null;
  const phone = invoiceConfig?.phone?.trim() || null;
  const email = invoiceConfig?.email?.trim() || null;

  // Bill-date-keyed aggregates (what was *billed* in the window):
  const totalBilled = bills.reduce((s, b) => s + b.amount, 0);
  const pendingBills = bills.filter((b) => b.balance > 0).length;
  const avgBill = bills.length > 0 ? Math.round(totalBilled / bills.length) : 0;
  // Discount summed across bills issued in the window.
  const totalDiscount = bills.reduce(
    (s, b) => s + (b.amount - b.amountPaid - b.balance),
    0,
  );

  // Receipt-date-keyed aggregates (what was *collected* in the window):
  const totalPaid = receipts.collected;
  const cashPaid = receipts.cashCollected;
  const otherPaid = receipts.otherCollected;
  const cashCount = receipts.cashCount;
  const otherCount = receipts.otherCount;
  const collectedPct = totalBilled > 0 ? ((totalPaid / totalBilled) * 100) | 0 : 0;

  return (
    <div
      data-accounts-report
      className="w-full bg-white text-black font-sans text-[11px] leading-snug"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="border border-gray-400 px-5 py-4 text-center">
        <p className="text-lg font-bold tracking-tight">{labName}</p>
        {address && <p className="mt-0.5 text-gray-600">{address}</p>}
        {(phone || email) && (
          <p className="mt-0.5 text-gray-600">
            {phone && <>Ph: {phone}</>}
            {phone && email && <span className="mx-2 text-gray-300">|</span>}
            {email && <>Email: {email}</>}
          </p>
        )}
      </div>

      {/* ── Title block ────────────────────────────────────────────── */}
      <div className="border-x border-b border-gray-400 px-5 py-3 text-center">
        <p className="text-base font-bold uppercase tracking-[0.2em] text-gray-700">
          Account Statement
        </p>
      </div>

      {/* ── Client + period ────────────────────────────────────────── */}
      <div className="border-x border-b border-gray-400 grid grid-cols-2 px-5 py-3 gap-x-4 gap-y-1.5">
        <ReportRow
          label="Client"
          value={
            mccName
              ? `${mccName}${mccCode ? ` (${mccCode})` : ''}`
              : mccCode ?? '—'
          }
        />
        <ReportRow
          label="Period"
          value={`${fmtIST(from, 'date')} → ${fmtIST(to, 'date')}`}
        />
        <ReportRow
          label="Generated"
          value={fmtIST(new Date().toISOString())}
        />
        <ReportRow label="Bills" value={`${bills.length}`} />
      </div>

      {/* ── Summary ────────────────────────────────────────────────── */}
      <div className="border-x border-b border-gray-400 px-5 py-3">
        <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-2">
          Summary
        </p>
        <div className="grid grid-cols-2 gap-x-8">
          <div className="space-y-1">
            <SummaryLine label="Total billed" value={inr(totalBilled)} />
            <SummaryLine
              label="Discount"
              value={`− ${inr(totalDiscount > 0 ? totalDiscount : 0)}`}
            />
            <SummaryLine
              label="Average bill"
              value={inr(avgBill)}
              muted
            />
          </div>
          <div className="space-y-1">
            <SummaryLine
              label="Collected in period"
              value={inr(totalPaid)}
              sub={`${receipts.receiptCount} payment${receipts.receiptCount === 1 ? '' : 's'} · ${collectedPct}% of billed`}
            />
            <div className="ml-3 space-y-0.5 text-gray-600">
              <SummaryLine
                label="Cash"
                value={`${inr(cashPaid)}  ·  ${cashCount} payment${cashCount === 1 ? '' : 's'}`}
                sm
              />
              <SummaryLine
                label="Others (UPI/Card/etc.)"
                value={`${inr(otherPaid)}  ·  ${otherCount} payment${otherCount === 1 ? '' : 's'}`}
                sm
              />
              {receipts.refunded > 0 && (
                <SummaryLine
                  label="Refunded"
                  value={`− ${inr(receipts.refunded)}`}
                  sm
                />
              )}
            </div>
            <div className="border-t border-gray-300 pt-1 mt-1">
              <SummaryLine
                label="Balance due (as of now)"
                value={inr(totalBalance)}
                sub={
                  pendingBills === 0
                    ? 'All settled'
                    : `${pendingBills} bill${pendingBills === 1 ? '' : 's'} pending`
                }
                bold
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Bills table ────────────────────────────────────────────── */}
      <div className="border-x border-b border-gray-400 px-5 py-3">
        <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-2">
          Bills
        </p>
        {bills.length === 0 ? (
          <p className="text-gray-500 text-sm py-2">
            No Telo bills for this client in this date range.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-300 bg-gray-50">
                <Th className="w-6">#</Th>
                <Th className="w-16">Date</Th>
                <Th className="w-20">Bill #</Th>
                <Th>Patient</Th>
                <Th>Ref. doctor</Th>
                <Th className="w-14">Pay</Th>
                <Th className="w-16 text-right">Amount</Th>
                <Th className="w-16 text-right">Paid*</Th>
                <Th className="w-16 text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b, idx) => {
                const txns = receiptsByBill[b.billId] ?? [];
                return (
                  <Fragment key={b.billId}>
                    <tr key={b.billId} className="border-b border-gray-100">
                      <Td className="text-gray-500">{idx + 1}</Td>
                      <Td>{fmtIST(b.billDate, 'date')}</Td>
                      <Td className="font-mono text-[10px]">
                        {b.billNumber ?? b.billId}
                      </Td>
                      <Td>{b.patientName ?? '—'}</Td>
                      <Td className="text-gray-700">{b.doctorName ?? '—'}</Td>
                      <Td className="text-[10px]">{b.paymentType ?? '—'}</Td>
                      <Td className="text-right">{inr(b.amount)}</Td>
                      <Td className="text-right">{inr(b.amountPaid)}</Td>
                      <Td className="text-right font-medium">{inr(b.balance)}</Td>
                    </tr>
                    {txns.map((tx, ti) => {
                      const isRefund = tx.kind === 'refund';
                      return (
                        <tr
                          key={`${b.billId}-tx-${ti}`}
                          className="border-b border-gray-50 bg-gray-50/60 text-[9px] text-gray-600"
                        >
                          <Td>{''}</Td>
                          <Td>{tx.date ? fmtIST(tx.date) : '—'}</Td>
                          <Td className="font-mono text-[9px]">
                            {tx.txnId ?? '—'}
                          </Td>
                          <Td colSpan={2}>
                            {tx.method ?? 'Cash'}
                            {isRefund && (
                              <span className="ml-1 rounded border border-red-300 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-red-700">
                                refund
                              </span>
                            )}
                          </Td>
                          <Td className="font-mono text-[9px]">
                            {tx.reference ?? '—'}
                          </Td>
                          <Td colSpan={2}>{''}</Td>
                          <Td
                            className={`text-right ${isRefund ? 'text-red-700' : ''}`}
                          >
                            {isRefund ? '− ' : ''}
                            {inr(tx.amount)}
                          </Td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-400 bg-gray-50 font-semibold">
                <Td colSpan={6} className="text-right pr-2 text-gray-600">
                  Totals
                </Td>
                <Td className="text-right">{inr(totalBilled)}</Td>
                <Td className="text-right">
                  {inr(bills.reduce((s, b) => s + b.amountPaid, 0))}
                </Td>
                <Td className="text-right">{inr(totalBalance)}</Td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="mt-2 text-[9px] text-gray-500 italic">
          * Paid is each bill&apos;s current paid total (may include payments
          made outside this period). For period cash-flow, see the
          &ldquo;Collected in period&rdquo; figure in the Summary above.
          Transaction sub-rows list every payment/refund with its Telo txn ID.
        </p>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="border-x border-b border-gray-400 grid grid-cols-2 items-end px-5 py-4">
        <p className="text-gray-400 text-[9px]">
          This is a computer-generated statement.
        </p>
        <div className="text-right">
          <div className="mb-6 border-b border-gray-400 inline-block w-36" />
          <p className="font-semibold">Authorised Signatory</p>
          <p className="text-gray-500">{labName}</p>
        </div>
      </div>
    </div>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-semibold text-gray-500 uppercase tracking-wide text-[9px] w-20 shrink-0">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  sub,
  bold,
  muted,
  sm,
}: {
  label: string;
  value: string;
  sub?: string;
  bold?: boolean;
  muted?: boolean;
  sm?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        sm ? 'text-[10px]' : 'text-[11px]'
      }`}
    >
      <span className={muted ? 'text-gray-500' : 'text-gray-700'}>{label}</span>
      <span className={bold ? 'font-bold' : 'font-medium'}>
        {value}
        {sub && (
          <span className="ml-2 text-[9px] font-normal text-gray-500">
            ({sub})
          </span>
        )}
      </span>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={`py-0.5 pr-2 ${className}`} colSpan={colSpan}>
      {children}
    </td>
  );
}
