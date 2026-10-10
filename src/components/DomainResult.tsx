import { ProviderChip } from "@/components/ProviderChip";
import { Table, Td, Th } from "@/components/ui/misc";
import { usd } from "@/lib/money";
import { PROVIDERS } from "@/lib/providers";
import type { DomainResult as Result, LookupRecord } from "@/lib/types";

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

/** One domain: technologies by category with the providers that listed each, then the providers' own status and overlap. */
export function DomainResultView({ r, records }: { r: Result; records: LookupRecord[] }) {
  const cats = [...new Set(r.technologies.map((t) => t.category))].sort();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-16 font-semibold">{r.domain}</h2>
        <p className="text-mute">
          {r.technologies.length} technologies from {r.listProviders.length} provider{r.listProviders.length === 1 ? "" : "s"}. Spent {usd(r.costMicros)}.
          {r.firstSeen && ` Earliest detection ${day(r.firstSeen)}, latest ${day(r.lastSeen)}.`}
        </p>
      </div>

      <section className="rounded-panel border border-line bg-panel" aria-label="Technologies by category">
        <div className="overflow-x-auto scroll-thin">
          <Table>
            <thead>
              <tr>
                <Th>Technology</Th>
                <Th>Category</Th>
                <Th>Listed by</Th>
                <Th>Agreement</Th>
                <Th>First seen</Th>
                <Th>Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {cats.flatMap((c) =>
                r.technologies
                  .filter((t) => t.category === c)
                  .map((t) => (
                    <tr key={t.slug} className="hover:bg-hover">
                      <Td className="font-medium">{t.name}</Td>
                      <Td className="text-mute">{c}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {t.providers.map((p) => (
                            <ProviderChip key={p} id={p} />
                          ))}
                        </div>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span className="inline-flex gap-0.5" aria-hidden>
                            {Array.from({ length: t.of }, (_, i) => (
                              <span key={i} className={i < t.providers.length ? "h-2 w-3 rounded-sm bg-emerald" : "h-2 w-3 rounded-sm bg-line-strong"} />
                            ))}
                          </span>
                          <span className="num text-12">
                            {t.providers.length} of {t.of}
                          </span>
                        </span>
                      </Td>
                      <Td className="num text-12 text-mute">{day(t.firstSeen) || "n/a"}</Td>
                      <Td className="num text-12 text-mute">{day(t.lastSeen) || "n/a"}</Td>
                    </tr>
                  )),
              )}
            </tbody>
          </Table>
        </div>
        <p className="border-t border-line px-3 py-2 text-12 text-mute">Dates are blank where no provider gave them. Names are matched across providers by a normalised key, so React and ReactJS count as one.</p>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-panel border border-line bg-panel" aria-label="Providers">
          <h3 className="border-b border-line p-3 font-semibold">Providers side by side</h3>
          <Table>
            <thead>
              <tr>
                <Th>Provider</Th>
                <Th>Result</Th>
                <Th className="text-right">Technologies</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.providerId}>
                  <Td>
                    <ProviderChip id={rec.providerId} />
                  </Td>
                  <Td className={rec.status === "ok" ? "" : rec.status === "pending" ? "text-amber" : "text-high"}>{rec.status === "ok" ? "answered" : rec.status}</Td>
                  <Td className="num text-right">{rec.data ? (PROVIDERS.find((p) => p.id === rec.providerId)?.listsTechnologies ? rec.data.technologies.length : `${rec.data.categoryCounts.length} categories`) : "n/a"}</Td>
                  <Td className="num text-right">{usd(rec.costMicros)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section className="rounded-panel border border-line bg-panel" aria-label="Overlap">
          <h3 className="border-b border-line p-3 font-semibold">How much providers agree</h3>
          {r.pairs.length === 0 ? (
            <p className="p-3 text-mute">Needs two providers that list technologies.</p>
          ) : (
            <ul className="divide-y divide-line">
              {r.pairs.map((p) => (
                <li key={p.a + p.b} className="flex items-center gap-2 p-3">
                  <ProviderChip id={p.a} /> <span className="text-mute">and</span> <ProviderChip id={p.b} />
                  <span className="num ml-auto text-12">
                    {p.shared} shared · {Math.round(p.jaccard * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.categoryCounts.length > 0 && (
            <p className="border-t border-line p-3 text-12 text-mute">
              BuiltWith Free counts: {r.categoryCounts.map((c) => `${c.name} ${c.live}`).join(", ")}.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
