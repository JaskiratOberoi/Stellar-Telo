import type { MccInvoiceConfig } from '@/db/read/invoiceConfig';

/**
 * MDCARE = MEDICARE SUPER SPECIALITY HOSPITAL (MCC code 'MDCARE'). It keeps the
 * legacy bill behavior (On behalf of Qugen, no disclaimer, signatory shown,
 * free-text prepared-by); every other client gets the new defaults. Detection
 * is by the MCC's MCCUnitCode, which is what the bill components receive.
 */
export function isMdcareMcc(mccCode: string | null | undefined): boolean {
  return (mccCode ?? '').trim().toLowerCase() === 'mdcare';
}

export type OnBehalfMode = 'client' | 'qugen';

export interface ResolvedInvoiceFlags {
  onBehalf: OnBehalfMode;
  showDisclaimer: boolean;
  showSignatory: boolean;
}

export const DISCLAIMER_TEXT =
  'All tests to be performed in the lab of Noble Diagnostics. This is just an invoice of the tests billed not proof that the tests have already been performed.';

/**
 * Resolve the per-MCC bill toggles, applying MDCARE-aware defaults wherever the
 * stored value is null ("auto"). Non-MDCARE → client name / disclaimer on /
 * signatory off. MDCARE → Qugen / disclaimer off / signatory on (today's
 * behavior, so MDCARE bills are unchanged).
 */
export function resolveInvoiceDefaults(
  config: Pick<
    MccInvoiceConfig,
    'onBehalfMode' | 'showDisclaimer' | 'showSignatory'
  > | null,
  mccCode: string | null | undefined,
): ResolvedInvoiceFlags {
  const md = isMdcareMcc(mccCode);
  return {
    onBehalf: config?.onBehalfMode ?? (md ? 'qugen' : 'client'),
    showDisclaimer: config?.showDisclaimer ?? !md,
    showSignatory: config?.showSignatory ?? md,
  };
}
