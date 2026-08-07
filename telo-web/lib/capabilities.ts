import type { Capability } from '@/types/auth';

/** Fixed catalog of Telo capabilities — adding a new feature still needs a
 *  code deploy. Admins only assign these existing caps to roles. */
export const ALL_CAPABILITIES: {
  value: Capability;
  label: string;
  group: string;
}[] = [
  { value: 'user:manage', label: 'User management', group: 'Admin' },
  { value: 'order:create', label: 'Create orders', group: 'Orders' },
  { value: 'order:accession', label: 'Accession SIDs', group: 'Orders' },
  { value: 'order:view', label: 'View orders', group: 'Orders' },
  { value: 'order:b2c', label: 'B2C channel', group: 'Orders' },
  { value: 'order:b2b', label: 'B2B channel', group: 'Orders' },
  { value: 'order:discount', label: 'Apply discount', group: 'Orders' },
  { value: 'patient:create', label: 'Create patients', group: 'Patients / Billing' },
  { value: 'patient:view', label: 'View patients', group: 'Patients / Billing' },
  { value: 'bill:view', label: 'View bills', group: 'Patients / Billing' },
  { value: 'payment:capture', label: 'Capture payments', group: 'Patients / Billing' },
  { value: 'payment:refund', label: 'Refund payments', group: 'Patients / Billing' },
  { value: 'rate:view', label: 'View rate lists', group: 'Rates' },
  { value: 'rate:manage', label: 'Manage rate lists', group: 'Rates' },
  { value: 'balance:view', label: 'View balances', group: 'Balances / Accounts / Sales' },
  { value: 'account:view', label: 'Client accounts', group: 'Balances / Accounts / Sales' },
  { value: 'account:manage', label: 'Record client payments', group: 'Balances / Accounts / Sales' },
  { value: 'sales:view', label: 'Sales data', group: 'Balances / Accounts / Sales' },
  { value: 'dashboard:view', label: 'Dashboard', group: 'Dashboard' },
  { value: 'report:view', label: 'Reporting', group: 'Reporting' },
];

export const CAPABILITY_SET: ReadonlySet<string> = new Set(
  ALL_CAPABILITIES.map((c) => c.value),
);

export function isCapability(v: string): v is Capability {
  return CAPABILITY_SET.has(v);
}
