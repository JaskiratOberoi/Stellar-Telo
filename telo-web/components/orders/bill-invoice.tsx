/**
 * BillInvoice — costing-only receipt (no sample IDs).
 * Shows header, bill meta, patient details, test line items, and summary.
 * Controlled by the `print-bill` class on <html> (see globals.css).
 */

import type { OrderDetail } from '@/db/read/orders';
import type { MccInvoiceConfig } from '@/db/read/invoiceConfig';
import { fmtIST } from '@/lib/datetime';

interface BillInvoiceProps {
  order: OrderDetail;
  mccName: string | null;
  config: MccInvoiceConfig | null;
}

const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BillInvoice({ order, mccName, config }: BillInvoiceProps) {
  const labName = config?.labName?.trim() || mccName?.trim() || 'Diagnostic Centre';
  const address = config?.address?.trim() || null;
  const phone   = config?.phone?.trim()   || null;
  const email   = config?.email?.trim()   || null;

  const dateLabel = fmtIST(order.billDate);
  const genderLabel =
    order.gender === 1 ? 'M' : order.gender === 2 ? 'F' : '—';

  const total = order.lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="w-full bg-white text-black font-sans text-[11px] leading-snug border border-gray-400">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="border-b border-gray-400 px-5 py-4 text-center">
        <p className="text-lg font-bold tracking-tight">{labName}</p>
        {address && (
          <p className="mt-0.5 text-gray-600">{address}</p>
        )}
        {(phone || email) && (
          <p className="mt-0.5 text-gray-600">
            {phone && <>Ph: {phone}</>}
            {phone && email && <span className="mx-2 text-gray-300">|</span>}
            {email && <>Email: {email}</>}
          </p>
        )}
      </div>

      {/* ── Bill meta ──────────────────────────────────────────────── */}
      <div className="border-b border-gray-400 grid grid-cols-2 px-5 py-3 gap-x-4">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-500 uppercase tracking-wide text-[9px]">Bill No.</span>
          <span className="font-bold">{order.billNumber ?? order.billId}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-500 uppercase tracking-wide text-[9px]">Date</span>
          <span>{dateLabel}</span>
        </div>
      </div>

      {/* ── Patient details ────────────────────────────────────────── */}
      <div className="border-b border-gray-400 px-5 py-3">
        <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-1.5">
          Patient Details
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="Name" value={order.patientName ?? '—'} />
          {order.patientId != null && (
            <Row label="PID" value={String(order.patientId)} mono />
          )}
          <Row label="Age / Sex" value={`${order.age ?? '—'} / ${genderLabel}`} />
          <Row label="Mobile" value={order.mobile ?? '—'} />
          {order.email && <Row label="Email" value={order.email} />}
          {order.refCustomerName && (
            <Row label="MRD / Visit" value={order.refCustomerName} />
          )}
          {order.refDoctorName && (
            <Row label="Ref. doctor" value={order.refDoctorName} />
          )}
          {order.paymentType && (
            <Row label="Payment" value={order.paymentType} />
          )}
        </div>
        {order.clinicalHistory && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <span className="text-gray-500 text-[9px] uppercase tracking-wide">Clinical history</span>
            <p className="mt-0.5 text-gray-700">{order.clinicalHistory}</p>
          </div>
        )}
      </div>

      {/* ── Line items ─────────────────────────────────────────────── */}
      <div className="border-b border-gray-400 px-5 py-3">
        <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-1.5">
          Services
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-300 bg-gray-50">
              <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-6">
                #
              </th>
              <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500">
                Description
              </th>
              <th className="py-1 text-right font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-28">
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                <td className="py-0.5 pr-2 text-gray-500">{idx + 1}</td>
                <td className="py-0.5 pr-2">{l.testName ?? '—'}</td>
                <td className="py-0.5 text-right">{inr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-300 bg-gray-50">
              <td colSpan={2} className="py-1 pr-2 font-semibold text-right text-gray-600">
                Sub-total
              </td>
              <td className="py-1 text-right font-semibold">{inr(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Payment history ────────────────────────────────────────── */}
      {order.receipts.length > 0 && (
        <div className="border-b border-gray-400 px-5 py-3">
          <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-1.5">
            Payments &amp; Refunds · {order.receipts.length}
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-300 bg-gray-50">
                <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-6">
                  #
                </th>
                <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-24">
                  Date
                </th>
                <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-20">
                  Method
                </th>
                <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500">
                  Reference
                </th>
                <th className="py-1 text-right font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-24">
                  Amount (₹)
                </th>
              </tr>
            </thead>
            <tbody>
              {order.receipts.map((rcpt, idx) => {
                const isRefund = rcpt.kind === 'refund';
                return (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-0.5 pr-2 text-gray-500">{idx + 1}</td>
                    <td className="py-0.5 pr-2">
                      {rcpt.date ? fmtIST(rcpt.date) : '—'}
                    </td>
                    <td className="py-0.5 pr-2">
                      {rcpt.method ?? 'Cash'}
                      {isRefund && (
                        <span className="ml-1.5 rounded border border-red-300 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-red-700">
                          refund
                        </span>
                      )}
                    </td>
                    <td className="py-0.5 pr-2 font-mono text-[10px] text-gray-600">
                      {rcpt.reference ?? '—'}
                    </td>
                    <td
                      className={`py-0.5 text-right ${isRefund ? 'text-red-700' : ''}`}
                    >
                      {isRefund ? '− ' : ''}
                      {inr(rcpt.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Summary ────────────────────────────────────────────────── */}
      <div className="border-b border-gray-400 px-5 py-3">
        <div className="ml-auto max-w-xs space-y-0.5">
          <SummaryRow label="Amount"   value={inr(order.amount)} />
          {order.discount > 0 && (
            <SummaryRow label="Discount" value={`− ${inr(order.discount)}`} />
          )}
          <SummaryRow label="Net paid" value={inr(order.amountPaid)} />
          <div className="border-t border-gray-300 pt-1 mt-1">
            <SummaryRow label="Balance Due" value={inr(order.balance)} bold />
          </div>
        </div>
      </div>

      {/* ── Notes ──────────────────────────────────────────────────── */}
      <div className="border-b border-gray-400 px-5 py-3">
        <p className="mb-1 font-semibold text-[10px] uppercase tracking-wide text-gray-600">
          Note:
        </p>
        <ol className="list-decimal space-y-0.5 pl-4 text-[10px] text-gray-700">
          <li>Not Valid for medico legal use.</li>
          <li>Non refundable, subject to realization of cheque.</li>
          <li>All above services are exempted under GST.</li>
        </ol>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 items-end px-5 py-4">
        <p className="text-gray-400 text-[9px]">
          This is a computer-generated bill.
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

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-gray-500 shrink-0 w-16">{label}</span>
      <span className={mono ? 'font-mono text-[10px]' : ''}>{value}</span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-bold' : ''}`}>
      <span className={bold ? '' : 'text-gray-600'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
