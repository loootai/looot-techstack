import type { TechstackConfig } from "./config";
import { findCompanies, lookupDomains, type LookupOutput } from "./engine";
import type { LoootRunner } from "./looot";
import { mergeDomain } from "./merge";
import { PROVIDERS, SEARCH_PROVIDERS, type Provider, type SearchProviderId } from "./providers";
import { buildQuote, buildSearchQuote, type Quote } from "./quote";
import type { State } from "./state";
import type { DomainResult } from "./types";

/** The providers to call: the ids asked for, else the config's list. Unknown ids are dropped. */
export function chooseProviders(ids: string[] | undefined, config: TechstackConfig): Provider[] {
  const want = ids && ids.length > 0 ? ids : config.providers;
  return PROVIDERS.filter((p) => want.includes(p.id));
}

export function chooseSearchProviders(ids: string[] | undefined): SearchProviderId[] {
  const all = SEARCH_PROVIDERS.map((s) => s.id) as SearchProviderId[];
  const picked = (ids ?? []).filter((i): i is SearchProviderId => (all as string[]).includes(i));
  return picked.length > 0 ? picked : all;
}

export const quoteLookup = (state: State, config: TechstackConfig, domains: string[], providers: Provider[], capMicros: number, now: Date): Quote => buildQuote(domains, providers, state.lookups, config.cacheDays, capMicros, now);
export const quoteFind = (state: State, config: TechstackConfig, tech: string, ids: SearchProviderId[], capMicros: number, now: Date): Quote => buildSearchQuote(tech, ids, state.searches, config.cacheDays, capMicros, now);

/** Runs the lookup and writes the answers into the state. */
export async function runLookup(state: State, config: TechstackConfig, looot: LoootRunner, domains: string[], providers: Provider[], capMicros: number, now: Date): Promise<LookupOutput> {
  const out = await lookupDomains({ domains, providers, looot, cache: state.lookups, cacheDays: config.cacheDays, capMicros, now });
  state.lookups = out.records;
  state.calls.push(...out.calls);
  return out;
}

export async function runFind(state: State, config: TechstackConfig, looot: LoootRunner, tech: string, ids: SearchProviderId[], capMicros: number, now: Date) {
  const out = await findCompanies({ tech, providerIds: ids, looot, cache: state.searches, cacheDays: config.cacheDays, capMicros, now });
  state.searches = out.records;
  state.calls.push(...out.calls);
  return out;
}

/** Merged results for the given domains, in the order given. */
export function resultsFor(state: State, domains: string[]): DomainResult[] {
  const all = Object.values(state.lookups);
  return domains.map((d) => mergeDomain(d, all));
}

/** One row per (domain, technology), for CSV and for filtering in the UI. */
export function flatten(results: DomainResult[]) {
  return results.flatMap((r) => r.technologies.map((t) => ({ domain: r.domain, technology: t.name, slug: t.slug, category: t.category, providers: t.providers, agreement: `${t.providers.length} of ${t.of}`, firstSeen: t.firstSeen, lastSeen: t.lastSeen })));
}

/** Companies from the stored searches for one technology, with the providers that listed each. */
export function searchHits(state: State, tech: string) {
  const by = new Map<string, { domain: string; name?: string; providers: string[]; firstSeen?: string; lastSeen?: string }>();
  for (const r of Object.values(state.searches)) {
    if (r.status !== "ok" || r.tech.toLowerCase() !== tech.toLowerCase()) continue;
    for (const h of r.hits) {
      const m = by.get(h.domain) ?? { domain: h.domain, name: h.name, providers: [] };
      if (!m.providers.includes(r.providerId)) m.providers.push(r.providerId);
      if (h.firstSeen && (!m.firstSeen || h.firstSeen < m.firstSeen)) m.firstSeen = h.firstSeen;
      if (h.lastSeen && (!m.lastSeen || h.lastSeen > m.lastSeen)) m.lastSeen = h.lastSeen;
      by.set(h.domain, m);
    }
  }
  return [...by.values()].sort((a, b) => b.providers.length - a.providers.length || a.domain.localeCompare(b.domain));
}
