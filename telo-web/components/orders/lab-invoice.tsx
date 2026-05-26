/**
 * LabInvoice — full lab receipt with patient details, tests, AND sample IDs.
 * Controlled by the `print-lab` class on <html> (see globals.css).
 */

import type { OrderDetail } from '@/db/read/orders';
import type { MccInvoiceConfig } from '@/db/read/invoiceConfig';
import { fmtIST } from '@/lib/datetime';

interface BillInvoiceProps {
  order: OrderDetail;
  /** MCCUnitName from tbl_med_mcc_unit_master */
  mccName: string | null;
  /** Per-MCC branding config from telo_mcc_invoice_config (may be null) */
  config: MccInvoiceConfig | null;
}

// (No currency formatting — the lab receipt is a pre-analytical document
// and intentionally omits all monetary breakdowns; see BillInvoice for those.)

export function LabInvoice({ order, mccName, config }: BillInvoiceProps) {
  const labName = config?.labName?.trim() || mccName?.trim() || 'Diagnostic Centre';
  const address = config?.address?.trim() || null;
  const phone   = config?.phone?.trim()   || null;
  const email   = config?.email?.trim()   || null;

  const dateLabel = fmtIST(order.billDate);
  const genderLabel =
    order.gender === 1 ? 'M' : order.gender === 2 ? 'F' : '—';

  // Lab receipt only needs a pass/fail payment indicator — the bill carries
  // the actual amount breakdown. balance === 0 with money received → Paid;
  // balance === 0 without payment received → No Charge; otherwise Pending.
  const paymentStatus: 'paid' | 'pending' | 'free' =
    order.balance > 0
      ? 'pending'
      : order.amountPaid > 0
        ? 'paid'
        : 'free';

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

      {/* ── Bill meta + payment status ─────────────────────────────── */}
      <div className="border-b border-gray-400 grid grid-cols-3 px-5 py-3 gap-x-4 items-center">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-500 uppercase tracking-wide text-[9px]">Receipt No.</span>
          <span className="font-bold">{order.billNumber ?? order.billId}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-500 uppercase tracking-wide text-[9px]">Date</span>
          <span>{dateLabel}</span>
        </div>
        <div className="flex justify-end">
          <PaymentStatusPill status={paymentStatus} />
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
          <Row
            label="Age / Sex"
            value={`${order.age ?? '—'} / ${genderLabel}`}
          />
          <Row label="Mobile" value={order.mobile ?? '—'} />
          {order.email && <Row label="Email" value={order.email} />}
          {order.refCustomerName && (
            <Row label="MRD / Visit" value={order.refCustomerName} />
          )}
          {order.refDoctorName && (
            <Row label="Ref. doctor" value={order.refDoctorName} />
          )}
        </div>
        {order.clinicalHistory && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <span className="text-gray-500 text-[9px] uppercase tracking-wide">Clinical history</span>
            <p className="mt-0.5 text-gray-700">{order.clinicalHistory}</p>
          </div>
        )}
      </div>

      {/* ── Tests table ────────────────────────────────────────────── */}
      <div className="border-b border-gray-400 px-5 py-3">
        <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-1.5">
          Tests
        </p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-300 bg-gray-50">
              <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-6">
                #
              </th>
              <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500 w-24">
                Code
              </th>
              <th className="py-1 pr-2 text-left font-semibold text-[9px] uppercase tracking-wide text-gray-500">
                Test Name
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                <td className="py-0.5 pr-2 text-gray-500">{idx + 1}</td>
                <td className="py-0.5 pr-2 font-mono text-[10px]">{l.testCode ?? '—'}</td>
                <td className="py-0.5 pr-2">{l.testName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Samples ────────────────────────────────────────────────── */}
      {order.samples.length > 0 && (
        <div className="border-b border-gray-400 px-5 py-3">
          <p className="font-semibold text-[9px] uppercase tracking-wide text-gray-500 mb-1.5">
            Sample IDs
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {order.samples.map((s) => (
              <div key={s.vailid} className="flex items-baseline gap-2 border-l-2 border-gray-300 pl-2">
                <span className="font-medium">{s.sampleTypeName}</span>
                <span className="font-mono text-[10px] text-gray-600">{s.vailid}</span>
                {s.testCodes && (
                  <span className="text-gray-400 text-[9px] truncate">{s.testCodes}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 items-end px-5 py-4">
        <p className="text-gray-400 text-[9px]">
          This is a computer-generated receipt.
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

function PaymentStatusPill({ status }: { status: 'paid' | 'pending' | 'free' }) {
  const styles =
    status === 'paid'
      ? 'border-green-700 text-green-700 bg-green-50'
      : status === 'pending'
        ? 'border-red-700 text-red-700 bg-red-50'
        : 'border-gray-400 text-gray-600 bg-gray-50';
  const label =
    status === 'paid' ? '✓ Paid' : status === 'pending' ? 'Payment Pending' : 'No Charge';
  return (
    <span
      className={`rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${styles}`}
    >
      {label}
    </span>
  );
}
