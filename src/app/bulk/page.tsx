import type { Metadata } from "next";
import { BulkClient } from "@/components/BulkClient";
import { LookupPanel } from "@/components/LookupPanel";
import { getResults } from "@/lib/app";
import { PROVIDERS } from "@/lib/providers";

export const metadata: Metadata = { title: "Bulk table" };
export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const { common, results } = await getResults();
  const providers = PROVIDERS.map((p) => ({ id: p.id, label: p.label, priceMicros: p.priceMicros, note: p.note, on: common.config.providers.includes(p.id) }));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Bulk table</h1>
        <p className="text-mute">Paste or upload domains. The quote is exact: each domain and provider pair is one call.</p>
      </div>
      <LookupPanel mode="bulk" providers={providers} runnable={common.hasToken || common.demo} />
      {results.length > 0 && <BulkClient results={results} />}
    </div>
  );
}
