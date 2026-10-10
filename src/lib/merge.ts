import { providerById } from "./providers";
import type { DomainResult, LookupRecord, MergedTech } from "./types";

const lo = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : a < b ? a : b);
const hi = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : a > b ? a : b);

/**
 * Puts every provider's answer for one domain side by side. A technology is matched across providers
 * by a name key, and `providers`/`of` give the agreement: how many of the providers that returned a
 * list named it. Dates are the widest range any provider gave.
 */
export function mergeDomain(domain: string, records: LookupRecord[]): DomainResult {
  const mine = records.filter((r) => r.domain === domain);
  const ok = mine.filter((r) => r.status === "ok" && r.data);
  const listers = ok.filter((r) => providerById(r.providerId)?.listsTechnologies);
  const by = new Map<string, MergedTech>();
  for (const r of listers) {
    for (const t of r.data!.technologies) {
      const m = by.get(t.slug) ?? { name: t.name, slug: t.slug, category: t.category, providers: [], of: listers.length };
      if (!m.providers.includes(r.providerId)) m.providers.push(r.providerId);
      if (m.category === "Other" && t.category !== "Other") m.category = t.category;
      m.firstSeen = lo(m.firstSeen, t.firstSeen);
      m.lastSeen = hi(m.lastSeen, t.lastSeen);
      m.confidence ??= t.confidence;
      by.set(t.slug, m);
    }
  }
  const technologies = [...by.values()].sort((a, b) => b.providers.length - a.providers.length || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const sets = listers.map((r) => ({ id: r.providerId, slugs: new Set(r.data!.technologies.map((t) => t.slug)) }));
  const pairs: DomainResult["pairs"] = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const shared = [...sets[i].slugs].filter((s) => sets[j].slugs.has(s)).length;
    const union = new Set([...sets[i].slugs, ...sets[j].slugs]).size;
    pairs.push({ a: sets[i].id, b: sets[j].id, shared, jaccard: union === 0 ? 0 : shared / union });
  }
  const free = ok.find((r) => r.data!.categoryCounts.length > 0);
  const dates = ok.map((r) => r.data!);
  return {
    domain,
    technologies,
    categoryCounts: free?.data!.categoryCounts ?? [],
    listProviders: listers.map((r) => r.providerId),
    pendingProviders: mine.filter((r) => r.status === "pending").map((r) => r.providerId),
    failedProviders: mine.filter((r) => r.status === "failed").map((r) => r.providerId),
    costMicros: mine.reduce((n, r) => n + r.costMicros, 0),
    pairs,
    firstSeen: dates.reduce<string | undefined>((m, d) => lo(m, d.firstSeen), undefined),
    lastSeen: dates.reduce<string | undefined>((m, d) => hi(m, d.lastSeen), undefined),
  };
}

