/** Shared auth/identity types. No IO — safe to import anywhere. */

/** Telo-side role (independent of the LIS usertype). One per user, assigned
 *  by a Telo Super Admin via the Admin panel. Source of truth for what tabs
 *  and actions the user sees once a row is present in tbl_telo_user_role. */
export type TeloRole =
  | 'super_admin'
  | 'admin'
  | 'billing'
  | 'technician'
  | 'viewer';

export type Capability =
  | 'user:manage'        // Admin panel (Super Admin only)
  | 'order:create'       // register a new order (FAB / /orders/new/create)
  | 'order:accession'    // add SIDs to an existing order (/orders/new/[id])
  | 'order:view'         // see the worklist + Orders feed tab
  | 'order:discount'
  | 'patient:create'
  | 'patient:view'
  | 'bill:view'
  | 'payment:capture'
  | 'rate:view'
  | 'rate:manage'
  | 'balance:view'
  | 'dashboard:view';    // Revenue KPIs / live dashboard (not for Technicians)

/** Raw row shape returned by dbo.usp_telo_authenticate. */
export interface AuthRow {
  user_id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  usertype_id: number | null;
  usertype_name: string | null;
  pcc_id: number | null;
  sub_pcc_id: number | null;
  business_unit_id: number | null;
  cap_auth: boolean;
  cap_discount: boolean;
  cap_edit_patient_tests: boolean;
  cap_result_entry: boolean;
  cap_patient_details: boolean;
}

/** Identity carried in the JWT (minimal — no MCC scope list here). */
export interface TeloUser {
  uid: number;
  username: string;
  name: string;
  email: string | null;
  usertypeId: number | null;
  usertypeName: string | null;
  pccId: number | null;
  subPccId: number | null;
  buId: number | null;
  /** Assigned Telo role, or null if the user has no tbl_telo_user_role row
   *  (then caps come from the LIS-derived fallback in auth/rbac.ts). */
  teloRole: TeloRole | null;
  caps: Capability[];
}
