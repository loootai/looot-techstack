import { DomainResultView } from "@/components/DomainResult";
import { LookupPanel } from "@/components/LookupPanel";
import { getRecords, getResults } from "@/lib/app";
import { normalizeDomain } from "@/lib/domain";
import { PROVIDERS } from "@/lib/providers";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function LookupPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const { common, results } = await getResults();
  const wanted = sp.d ? normalizeDomain(sp.d) : null;
  const selected = results.find((r) => r.domain === wanted) ?? results[0];
  const records = selected ? await getRecords(selected.domain) : [];
  const providers = PROVIDERS.map((p) => ({ id: p.id, label: p.label, priceMicros: p.priceMicros, note: p.note, on: common.config.providers.includes(p.id) }));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Technology lookup</h1>
        <p className="text-mute">Enter a domain, choose providers, see the price, then run. Answers are stored, so asking again is free.</p>
      </div>
      <LookupPanel mode="single" providers={providers} runnable={common.hasToken || common.demo} />
      {results.length > 0 && (
        <nav aria-label="Looked up domains" className="flex flex-wrap gap-1.5">
          {results.map((r) => (
            <a key={r.domain} href={`/?d=${encodeURIComponent(r.domain)}`} aria-current={r.domain === selected?.domain ? "page" : undefined} className={`num rounded-control border px-2 py-1 text-12 ${r.domain === selected?.domain ? "border-emerald bg-brand-soft text-link" : "border-line bg-panel text-mute hover:bg-hover"}`}>
              {r.domain}
            </a>
          ))}
        </nav>
      )}
      {selected ? <DomainResultView r={selected} records={records} /> : <p className="rounded-panel border border-line bg-panel p-8 text-center text-mute">No lookups yet.</p>}
    </div>
  );
}
