import { usd, usdPrecise } from "@/lib/money";
import type { Quote } from "@/lib/quote";

/** The price of a run, line by line, before it happens. */
export function QuoteBox({ quote }: { quote: Quote }) {
  return (
    <div className="rounded-control bg-hover p-3">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {quote.lines.map((l) => (
          <div key={l.providerId} className="contents">
            <dt>
              {l.label}
              <span className="num block text-12 text-mute">
                {l.calls} x {usdPrecise(l.priceMicros)} · {l.endpointId}
              </span>
            </dt>
            <dd className="num text-right">{usd(l.calls * l.priceMicros)}</dd>
          </div>
        ))}
        <dt className="border-t border-line-strong pt-1 font-medium">Total at list price</dt>
        <dd className="num border-t border-line-strong pt-1 text-right font-medium">{usd(quote.totalMicros)}</dd>
        <dt className="text-mute">Spend cap</dt>
        <dd className="num text-right text-mute">{usd(quote.capMicros)}</dd>
      </dl>
      {quote.cached > 0 && <p className="mt-1 text-12 text-mute">{quote.cached} stored answers are free.</p>}
      {quote.capBinds && <p className="mt-1 text-12 text-high">The total is above the cap, so the run will stop early.</p>}
    </div>
  );
}
