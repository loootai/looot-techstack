"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QuoteBox } from "@/components/QuoteBox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usd, usdPrecise } from "@/lib/money";
import type { Quote } from "@/lib/quote";

export interface ProviderInfo {
  id: string;
  label: string;
  priceMicros: number;
  note: string;
  on: boolean;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Domain input with provider choice, a live quote, and a run button that shows the amount. */
export function LookupPanel({ mode, providers, runnable, initial = "" }: { mode: "single" | "bulk"; providers: ProviderInfo[]; runnable: boolean; initial?: string }) {
  const router = useRouter();
  const [text, setText] = React.useState(initial);
  const [ids, setIds] = React.useState(providers.filter((p) => p.on).map((p) => p.id));
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [invalid, setInvalid] = React.useState<string[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() === "") return void setQuote(null);
      post<{ quote: Quote; invalid: string[] }>("/api/quote", { text, providers: ids }).then((r) => (setQuote(r.quote), setInvalid(r.invalid)), () => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [text, ids]);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ domains: string[]; spentMicros: number; calls: number; notRun: number }>("/api/lookup", { text, providers: ids });
      setMsg(`Made ${r.calls} calls and spent ${usd(r.spentMicros)}.${r.notRun > 0 ? ` Stopped at the cap, ${r.notRun} not run.` : ""}`);
      if (mode === "single") router.push(`/?d=${encodeURIComponent(r.domains[0])}`);
      else setText("");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = quote?.totalMicros ?? 0;
  return (
    <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4" aria-label="Look up domains">
      {mode === "single" ? (
        <Input aria-label="Domain" placeholder="stripe.com" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && quote && runnable && run()} className="num" />
      ) : (
        <>
          <textarea aria-label="Domains" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"One per line, comma separated, or a CSV with a domain column\nbrightloop.example\norbitpay.example"} className="num w-full rounded-control border border-line-strong bg-panel p-2.5 text-12 placeholder:text-faint focus-visible:border-emerald" />
          <input type="file" accept=".csv,.txt" aria-label="Choose a file" className="text-12" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        </>
      )}
      <fieldset className="grid gap-1.5 sm:grid-cols-2">
        <legend className="mb-1 text-12 font-medium">Providers</legend>
        {providers.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-control border border-line p-2 hover:bg-hover">
            <input type="checkbox" className="mt-0.5 accent-[var(--emerald)]" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
            <span>
              <span className="font-medium">{p.label}</span> <span className="num text-12 text-mute">{p.priceMicros === 0 ? "free" : `${usdPrecise(p.priceMicros)} a domain`}</span>
              <span className="block text-12 text-mute">{p.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {invalid.length > 0 && <p className="text-12 text-amber">Not domains, skipped: {invalid.slice(0, 5).join(", ")}</p>}
      {quote && <QuoteBox quote={quote} />}
      {!runnable && <p className="text-12 text-high">LOOOT_TOKEN is not set on the server, so the run is disabled. The CLI with --dry-run shows the same quote.</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={busy || !runnable || !quote || quote.domains === 0 || ids.length === 0} onClick={run}>
          {quote ? `Look up for ${usd(Math.min(total, quote.capMicros))}` : "Look up"}
        </Button>
        {msg && <p role="status" className="text-link">{msg}</p>}
      </div>
    </section>
  );
}
