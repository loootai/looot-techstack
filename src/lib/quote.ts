import { cacheId, isFresh, searchCacheId } from "./engine";
import { SEARCH_PROVIDERS, type Provider, type SearchProviderId } from "./providers";
import type { LookupRecord, SearchRecord } from "./types";

export interface QuoteLine {
  providerId: string;
  label: string;
  endpointId: string;
  calls: number;
  priceMicros: number;
}
export interface Quote {
  domains: number;
  /** domain and provider pairs that already have a fresh answer. */
  cached: number;
  lines: QuoteLine[];
  /** Exact: every call in `lines` runs, at list price. */
  totalMicros: number;
  capMicros: number;
  capBinds: boolean;
}

/** Prices a lookup before it runs. The count is exact because each (domain, provider) pair is one call. */
export function buildQuote(domains: string[], providers: Provider[], cache: Record<string, LookupRecord>, cacheDays: number, capMicros: number, now: Date): Quote {
  let cached = 0;
  const lines: QuoteLine[] = providers.map((p) => {
    const fresh = domains.filter((d) => isFresh(cache[cacheId(p.id, d)], cacheDays, now)).length;
    cached += fresh;
    return { providerId: p.id, label: p.label, endpointId: p.endpointId, calls: domains.length - fresh, priceMicros: p.priceMicros };
  });
  const totalMicros = lines.reduce((n, l) => n + l.calls * l.priceMicros, 0);
  return { domains: domains.length, cached, lines, totalMicros, capMicros, capBinds: totalMicros > capMicros };
}

/** Prices a "find companies using X" search. */
export function buildSearchQuote(tech: string, ids: SearchProviderId[], cache: Record<string, SearchRecord>, cacheDays: number, capMicros: number, now: Date): Quote {
  const lines: QuoteLine[] = SEARCH_PROVIDERS.filter((s) => ids.includes(s.id)).map((s) => ({ providerId: s.id, label: s.label, endpointId: s.endpointId, calls: isFresh(cache[searchCacheId(s.id, tech)], cacheDays, now) ? 0 : 1, priceMicros: s.priceMicros }));
  const totalMicros = lines.reduce((n, l) => n + l.calls * l.priceMicros, 0);
  return { domains: 1, cached: lines.filter((l) => l.calls === 0).length, lines, totalMicros, capMicros, capBinds: totalMicros > capMicros };
}
