/**
 * BillInvoice — costing-only receipt (no sample IDs).
 * Shows header, bill meta, patient details, test line items, and summary.
 * Controlled by the `print-bill` class on <html> (see globals.css).
 */

import type { OrderDetail } from '@/db/read/orders';
import type { MccInvoiceConfig } from '@/db/read/invoiceConfig';
import { fmtIST } from '@/lib/datetime';
import {
  medicareLogoPath,
  MEDICARE_MCC_CODES,
} from '@/lib/invoice-logo';

interface BillInvoiceProps {
  order: OrderDetail;
  mccName: string | null;
  /**
   * MCCUnitCode (string) for the bill's MCC. Used to gate co-branding —
   * Medicare logo renders top-right when this matches `medicare_test` or
   * `medicare_tech` (case-insensitive). Pass null when unknown.
   */
  mccCode: string | null;
  config: MccInvoiceConfig | null;
  /**
   * URL to the per-MCC custom logo bytes (typically `/api/mcc-invoice-logo/[mccId]`).
   * Pass null when no logo is uploaded for this MCC. The endpoint serves the
   * bytes with an ETag + private cache header, so repeat opens of the order
   * page reuse the browser's image cache (no fresh DB read or HTML inflation
   * — the previous data-URI approach embedded ~40 KB per page load).
   *
   * The print path (see print-bill-button.tsx) waits for all images in the
   * cloned block to finish loading before calling print(), so the URL-based
   * approach no longer races the print snapshot.
   */
  customLogoSrc: string | null;
}

const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function resolveTopRightLogo(
  mccCode: string | null,
  config: MccInvoiceConfig | null,
  customLogoSrc: string | null,
): { src: string; alt: string; width: number; height: number } | null {
  // Custom upload (served by the auth-gated /api/mcc-invoice-logo route)
  // wins. Falls back to the built-in Medicare brand for the special
  // Medicare MCC codes when no upload is present.
  if (config?.hasTopRightLogo && customLogoSrc) {
    return {
      src: customLogoSrc,
      alt: 'Partner logo',
      width: 104,
      height: 72,
    };
  }
  if (mccCode && MEDICARE_MCC_CODES.has(mccCode.trim().toLowerCase())) {
    return {
      src: medicareLogoPath(),
      alt: 'Medicare Superspeciality Hospital',
      width: 104,
      height: 72,
    };
  }
  return null;
}

export function BillInvoice({
  order,
  mccName,
  mccCode,
  config,
  customLogoSrc,
}: BillInvoiceProps) {
  const labName = config?.labName?.trim() || mccName?.trim() || 'Diagnostic Centre';
  const address = config?.address?.trim() || null;
  const phone   = config?.phone?.trim()   || null;
  const email   = config?.email?.trim()   || null;

  const customLogo = resolveTopRightLogo(mccCode, config, customLogoSrc);
  const noblePos = config?.nobleLogoPosition ?? 'left';
  const nobleVisible = config?.nobleLogoVisible ?? true;
  const customVisible = config?.customLogoVisible ?? true;

  // Plain <img> on purpose — BillInvoice is mounted inside a `hidden print:block`
  // wrapper (display:none on screen). Next/Image's wrapper + IntersectionObserver
  // path doesn't reliably preload inside a display:none ancestor, so the print
  // preview captures an empty slot. A native <img> with default eager loading is
  // fetched by the browser as soon as it's parsed, even while the container is
  // hidden, and prints crisply at the @page DPI without runtime optimization.
  const noblePane = nobleVisible ? (
    // eslint-disable-next-line @next/next/no-img-element -- print-only invoice; see comment above
    <img
      src="/branding/noble-logo.png"
      alt="Noble Diagnostics"
      width={224}
      height={56}
      className="h-14 w-auto print:h-[16mm] print:block"
    />
  ) : null;

  const customPane = customVisible && customLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- print-only invoice; see comment above
    <img
      src={customLogo.src}
      alt={customLogo.alt}
      width={customLogo.width}
      height={customLogo.height}
      className="h-16 w-auto print:h-[18mm] print:block"
    />
  ) : null;

  const leftPane = noblePos === 'left' ? noblePane : customPane;
  const rightPane = noblePos === 'left' ? customPane : noblePane;

  const dateLabel = fmtIST(order.billDate);
  const genderLabel =
    order.gender === 1 ? 'M' : order.gender === 2 ? 'F' : '—';

  const total = order.lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="w-full bg-white text-black font-sans text-[11px] leading-snug border border-gray-400">
      {/* ── Header: [left logo] | lab name block | [right logo] ──────────────
           Layout per dbo.telo_mcc_invoice_config (Telo only, no LIS DDL):
             noble_logo_position  = 'left' | 'right'  (default 'left')
             noble_logo_visible   = 0/1                (default 1)
             custom_logo_visible  = 0/1                (default 1)
           Custom logo always renders opposite Noble. */}
      <div className="border-b border-gray-400 px-5 py-4 grid grid-cols-[auto_1fr_auto] items-center gap-4">
        <div className="flex items-center justify-start min-w-[88px]">{leftPane}</div>
        <div className="text-center min-w-0">
          <p className="text-lg font-bold tracking-tight truncate">{labName}</p>
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
        <div className="flex items-center justify-end min-w-[88px]">{rightPane}</div>
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
          <p className="mt-1.5 text-right text-[10px] italic text-gray-500">
            On behalf of Qugen Pathlabs Pvt. Ltd.
          </p>
        </div>
      </div>

      {/* ── Prepared by ────────────────────────────────────────────── */}
      {config?.preparedBy?.trim() && (
        <div className="border-b border-gray-400 px-5 py-2">
          <p className="text-[10px] text-gray-700">
            <span className="font-semibold uppercase tracking-wide text-gray-600">
              Prepared By:
            </span>{' '}
            {config.preparedBy.trim()}
          </p>
        </div>
      )}

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
