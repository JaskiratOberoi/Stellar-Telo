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

/** Where a priced catalog row's `rate` came from. */
export type CatalogRateSource = 'ratelist' | 'mrp' | 'none';

/**
 * Catalog row priced for a specific client (MCC). `rate` is the price the
 * logged-in account would actually be billed: the client's assigned rate-list
 * price when the item is on that list, otherwise the catalogue MRP. `mrp` is
 * kept alongside so the UI can show "list price" context when the two differ.
 * Still cost-free (extends the public, costCt-stripped view).
 */
export interface CatalogItemPriced extends CatalogItemPublic {
  rate: number | null;
  rateSource: CatalogRateSource;
}

export interface CatalogQuery {
  q?: string; // fuzzy substring on code or name
  kind?: CatalogKind | 'all';
  limit?: number;
}
