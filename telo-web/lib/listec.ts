import 'server-only';
import { env } from '@/lib/env';
import { cached } from '@/lib/cache';

/**
 * Typed client for the existing read-only Listec container. Reads we don't
 * want to re-implement (master lookups, MCC units + normalised geography)
 * are proxied here and redis-cached, rather than re-querying Noble.
 */
export interface ListecLookups {
  businessUnits: string[];
  statuses: string[];
  departments: string[];
}

export interface MccUnit {
  code: string;
  name: string | null;
  businessUnitCode: string | null;
  cityLabel: string;
  stateLabel: string;
  rateLabel: string | null;
}

async function listecGet<T>(pathname: string): Promise<T> {
  const url = `${env().LISTEC_API_BASE_URL}${pathname}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    // Listec is internal; never cache at the fetch layer — we cache in redis.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Listec ${pathname} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getLookups(): Promise<ListecLookups> {
  return cached('telo:listec:lookups', 900, () =>
    listecGet<ListecLookups>('/api/lookups'),
  );
}

export async function getMccUnits(): Promise<MccUnit[]> {
  return cached('telo:listec:mcc-units', 900, async () => {
    const raw = await listecGet<{ rows: MccUnit[] }>('/api/mcc-units');
    return raw.rows ?? [];
  });
}
