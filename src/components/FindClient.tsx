"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QuoteBox } from "@/components/QuoteBox";
import { adminFetch } from "@/components/adminFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usd } from "@/lib/money";
import type { Quote } from "@/lib/quote";

export interface SearchInfo {
  id: string;
  label: string;
  note: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await adminFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function FindClient({ providers, runnable, initial = "" }: { providers: SearchInfo[]; runnable: boolean; initial?: string }) {
  const router = useRouter();
  const [tech, setTech] = React.useState(initial);
  const [ids, setIds] = React.useState(providers.map((p) => p.id));
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => (tech.trim() === "" ? setQuote(null) : post<{ quote: Quote }>("/api/quote", { kind: "find", tech, providers: ids }).then((r) => setQuote(r.quote), () => setQuote(null))), 250);
    return () => clearTimeout(t);
  }, [tech, ids]);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ spentMicros: number; calls: number; notRun: number }>("/api/find", { tech, providers: ids, quoteMicros: quote?.totalMicros ?? 0 });
      setMsg(`Made ${r.calls} calls and spent ${usd(r.spentMicros)}.${r.notRun > 0 ? ` ${r.notRun} skipped at the cap.` : ""}`);
      router.push(`/find?t=${encodeURIComponent(tech.trim())}`);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-label="Find companies using a technology">
      <Input aria-label="Technology" placeholder="HubSpot" value={tech} onChange={(e) => setTech(e.target.value)} />
      <fieldset className="grid gap-1.5 sm:grid-cols-2">
        <legend className="mb-1 text-12 font-medium">Providers</legend>
        {providers.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-control border border-line p-2 hover:bg-hover">
            <input type="checkbox" className="mt-0.5 accent-[var(--emerald)]" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="block text-12 text-mute">{p.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {quote && <QuoteBox quote={quote} />}
      {!runnable && <p className="text-12 text-high">LOOOT_TOKEN is not set on the server, so the run is disabled.</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={busy || !runnable || !quote || ids.length === 0} onClick={run}>
          {quote ? `Search for ${usd(Math.min(quote.totalMicros, quote.capMicros))}` : "Search"}
        </Button>
        {msg && <p role="status" className="text-link">{msg}</p>}
      </div>
    </section>
  );
}
