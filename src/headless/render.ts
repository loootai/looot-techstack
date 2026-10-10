import { usd, usdPrecise } from "@/lib/money";
import type { Quote } from "@/lib/quote";
import { flatten } from "@/lib/service";
import type { DomainResult } from "@/lib/types";
import { providerById } from "@/lib/providers";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const label = (id: string) => providerById(id)?.label ?? id;

export function renderQuote(q: Quote, what: string, priceNote: string): string {
  return [
    `${what}: ${q.cached} answers already stored (free), the rest run.`,
    ...q.lines.map((l) => `  ${l.label}: ${l.calls} x ${usdPrecise(l.priceMicros)} = ${usd(l.calls * l.priceMicros)}  [company.technographics, ${l.endpointId}]`),
    `Total: ${usd(q.totalMicros)}. Spend cap: ${usd(q.capMicros)}${q.capBinds ? " (the run will stop at the cap)" : ""}.`,
    priceNote,
  ].join("\n");
}

/** One CSV row per domain and technology. */
export function renderCsv(results: DomainResult[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ["domain", "technology", "category", "providers", "agreement", "first_seen", "last_seen"];
  const rows = flatten(results).map((r) => [r.domain, r.technology, r.category, r.providers.join("+"), r.agreement, day(r.firstSeen), day(r.lastSeen)]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** A markdown report: per domain, technologies by category with provider agreement. */
export function renderMarkdown(results: DomainResult[], title: string, found?: { tech: string; hits: { domain: string; providers: string[] }[] }): string {
  const out = [`# ${title}`, ""];
  for (const r of results) {
    out.push(`## ${r.domain}`, "");
    out.push(`${r.technologies.length} technologies from ${r.listProviders.map(label).join(", ") || "no provider"}. Spent ${usd(r.costMicros)}.${r.pendingProviders.length ? ` Pending: ${r.pendingProviders.map(label).join(", ")}.` : ""}${r.failedProviders.length ? ` Failed: ${r.failedProviders.map(label).join(", ")}.` : ""}`, "");
    const cats = [...new Set(r.technologies.map((t) => t.category))].sort();
    for (const c of cats) {
      out.push(`**${c}**`, "", "| Technology | Providers | Agreement | First seen | Last seen |", "|---|---|---|---|---|");
      for (const t of r.technologies.filter((x) => x.category === c)) out.push(`| ${cell(t.name)} | ${t.providers.map(label).join(", ")} | ${t.providers.length} of ${t.of} | ${day(t.firstSeen)} | ${day(t.lastSeen)} |`);
      out.push("");
    }
    if (r.pairs.length > 0) out.push("Overlap between providers: " + r.pairs.map((p) => `${label(p.a)} and ${label(p.b)} share ${p.shared} (${Math.round(p.jaccard * 100)}%)`).join("; ") + ".", "");
  }
  if (found) {
    out.push(`## Companies using ${found.tech}`, "", "| Domain | Providers |", "|---|---|");
    for (const h of found.hits) out.push(`| ${h.domain} | ${h.providers.map(label).join(", ")} |`);
    out.push("");
  }
  return out.join("\n");
}
