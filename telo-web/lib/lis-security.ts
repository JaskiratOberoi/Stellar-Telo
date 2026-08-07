/** Shared LIS Security Master types/constants (safe for client + server). */

export interface LisAuthBits {
  Auth: boolean;
  EditPatientTests: boolean;
  Result_Entry: boolean;
  Result_Edit: boolean;
  Reject_Sample: boolean;
  Edit_Sales_target: boolean;
  patient_details: boolean;
  Discount: boolean;
  Covid19: boolean;
}

export const EMPTY_AUTH_BITS: LisAuthBits = {
  Auth: false,
  EditPatientTests: false,
  Result_Entry: false,
  Result_Edit: false,
  Reject_Sample: false,
  Edit_Sales_target: false,
  patient_details: false,
  Discount: false,
  Covid19: false,
};

export const AUTH_BIT_LABELS: { key: keyof LisAuthBits; label: string }[] = [
  { key: 'Auth', label: 'Authorization' },
  { key: 'Discount', label: 'Discount' },
  { key: 'EditPatientTests', label: 'Edit Patient Tests' },
  { key: 'Result_Entry', label: 'Result Entry' },
  { key: 'Result_Edit', label: 'Edit Result' },
  { key: 'Reject_Sample', label: 'Reject Sample' },
  { key: 'patient_details', label: 'Patient Details' },
  { key: 'Edit_Sales_target', label: 'Edit Sales Target' },
  { key: 'Covid19', label: 'COVID-19' },
];
