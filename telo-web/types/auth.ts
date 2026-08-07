/** Shared auth/identity types. No IO — safe to import anywhere. */

/** Telo-side role key (independent of the LIS usertype). Built-ins are seeded
 *  (`super_admin`, `billing`, …); Admins may add custom keys via Roles hub.
 *  Assigned per user in `tbl_telo_user_role`; definitions live in `telo_role`. */
export type TeloRole = string;

export type Capability =
  | 'user:manage'        // Admin panel (Super Admin only)
  | 'order:create'       // register a new order (FAB / /orders/new/create)
  | 'order:accession'    // add SIDs to an existing order (/orders/new/[id])
  | 'order:view'         // see the worklist + Orders feed tab
  | 'order:b2c'          // access the B2C channel — "New order" tab + /orders/new(/create)
  | 'order:b2b'          // access the B2B channel — "Patient Orders" tab + /orders/b2b(/create)
  | 'order:discount'
  | 'patient:create'
  | 'patient:view'
  | 'bill:view'
  | 'payment:capture'
  | 'payment:refund'
  | 'rate:view'
  | 'rate:manage'
  | 'balance:view'
  | 'account:view'       // Client Accounts — franchise wallet ledger (read-only; mirrors LIS Mcc_Account, menu 18)
  | 'account:manage'     // Record manual client payments into the franchise wallet (Super Admin only)
  | 'sales:view'         // Sales Data — per-franchise itemised test sales (read-only; mirrors LIS SalesDataforMcc, menu 32)
  | 'dashboard:view'     // Revenue KPIs / live dashboard (not for Technicians)
  | 'report:view';       // Reporting tab — customer-facing result reports (super admin only for now)

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
  /** Session-version snapshot captured at login. Compared against the live
   *  value in `dbo.telo_user_session_version` on every auth() call — if
   *  they differ, the JWT is treated as revoked (admin deactivated the
   *  account, changed their role, reset their password, etc.). */
  sv: number;
}
