/** Unified catalog item — a single test or a profile/package. Pure types. */

export type CatalogKind = 'test' | 'profile';

/**
 * Server-side catalog item — includes internal `costCt` (CT/cost pricing).
 * NEVER return this directly from a server action; map to CatalogItemPublic
 * via toPublicCatalogItem() first. The cost number is operationally sensitive
 * and must not be exposed to client bundles or RSC payloads.
 */
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

/**
 * Client-safe view of a catalog item. Identical shape minus `costCt`. Every
 * action that returns catalog rows to a client component returns this type so
 * the cost column can never leak through RSC serialization.
 */
export type CatalogItemPublic = Omit<CatalogItem, 'costCt'>;

export function toPublicCatalogItem(i: CatalogItem): CatalogItemPublic {
  return {
    id: i.id,
    kind: i.kind,
    code: i.code,
    name: i.name,
    departmentId: i.departmentId,
    mrp: i.mrp,
  };
}

export interface CatalogQuery {
  q?: string; // fuzzy substring on code or name
  kind?: CatalogKind | 'all';
  limit?: number;
}
