"use client";

import * as React from "react";
import { Download, X } from "lucide-react";
import { ProviderChip } from "@/components/ProviderChip";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/misc";
import { usd } from "@/lib/money";
import type { DomainResult } from "@/lib/types";

/** All looked-up domains in one table, with a technology filter (every chosen technology must be present) and a category filter. */
export function BulkClient({ results }: { results: DomainResult[] }) {
  const [picked, setPicked] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");
  const [cat, setCat] = React.useState("");
  const all = React.useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of results) for (const t of r.technologies) m.set(t.slug, { name: t.name, n: (m.get(t.slug)?.n ?? 0) + 1 });
    return [...m].map(([slug, v]) => ({ slug, ...v })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [results]);
  const cats = React.useMemo(() => [...new Set(results.flatMap((r) => r.technologies.map((t) => t.category)))].sort(), [results]);
  const shown = results.filter((r) => picked.every((s) => r.technologies.some((t) => t.slug === s)) && (cat === "" || r.technologies.some((t) => t.category === cat)));
  const add = (v: string) => {
    const hit = all.find((t) => t.name.toLowerCase() === v.trim().toLowerCase());
    if (hit && !picked.includes(hit.slug)) setPicked([...picked, hit.slug]);
    setDraft("");
  };
  const nameOf = (slug: string) => all.find((t) => t.slug === slug)?.name ?? slug;

  return (
    <section aria-label="Domains" className="rounded-panel border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="flex min-w-60 flex-1 flex-wrap items-center gap-1">
          {picked.map((s) => (
            <span key={s} className="inline-flex h-7 items-center gap-1 rounded bg-brand-soft pl-2 text-12 text-link">
              {nameOf(s)}
              <button type="button" aria-label={`Remove ${nameOf(s)}`} onClick={() => setPicked(picked.filter((x) => x !== s))} className="flex size-7 items-center justify-center">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input aria-label="Filter by technology" list="tech-list" placeholder="Filter: uses technology…" value={draft} onChange={(e) => (all.some((t) => t.name.toLowerCase() === e.target.value.toLowerCase()) ? add(e.target.value) : setDraft(e.target.value))} onKeyDown={(e) => e.key === "Enter" && add(draft)} className="w-56" />
          <datalist id="tech-list">
            {all.map((t) => (
              <option key={t.slug} value={t.name} />
            ))}
          </datalist>
        </div>
        <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} className="w-52">
          <option value="">Every category</option>
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <a href="/api/export" className={buttonClass("secondary")}>
          <Download /> CSV
        </a>
      </div>
      {shown.length === 0 ? (
        <p className="p-8 text-center text-mute">No domain uses all of these technologies.</p>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <Table>
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th className="text-right">Technologies</Th>
                <Th>Technologies (most agreed first)</Th>
                <Th>Providers</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.domain} className="hover:bg-hover">
                  <Td className="h-12">
                    <a href={`/?d=${encodeURIComponent(r.domain)}`} className="num font-medium hover:underline">
                      {r.domain}
                    </a>
                  </Td>
                  <Td className="num text-right">{r.technologies.length}</Td>
                  <Td className="max-w-md">
                    <div className="flex flex-wrap gap-1">
                      {r.technologies.slice(0, 7).map((t) => (
                        <span key={t.slug} className={picked.includes(t.slug) ? "rounded bg-brand-soft px-1.5 text-12 text-link" : "rounded bg-hover px-1.5 text-12"}>
                          {t.name}
                          <span className="num text-mute"> {t.providers.length}/{t.of}</span>
                        </span>
                      ))}
                      {r.technologies.length > 7 && <span className="text-12 text-mute">+{r.technologies.length - 7}</span>}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {r.listProviders.map((p) => (
                        <ProviderChip key={p} id={p} />
                      ))}
                    </div>
                  </Td>
                  <Td className="num text-right">{usd(r.costMicros)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p className="border-t border-line px-3 py-2 text-12 text-mute">
        {shown.length} of {results.length} domains. The n/m next to a technology is how many of the providers that returned a list named it.
      </p>
    </section>
  );
}
