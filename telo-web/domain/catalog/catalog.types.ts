/** Unified catalog item — a single test or a profile/package. Pure types. */

export type CatalogKind = 'test' | 'profile';

export interface CatalogItem {
  /** tbl_med_test_master.id (test) or tbl_med_test_profile_master.id (profile) */
  id: number;
  kind: CatalogKind;
  code: string; // TestCode / Profile_Code
  name: string; // Testname / Profile_Name
  departmentId: number | null;
  /** List/MRP price — indicative only. Real price is re-resolved per MCC (P3). */
  mrp: number | null;
  costCt: number | null;
}

export interface CatalogQuery {
  q?: string; // fuzzy substring on code or name
  kind?: CatalogKind | 'all';
  limit?: number;
}
