import type { Metadata } from "next";
import { FindClient } from "@/components/FindClient";
import { ProviderChip } from "@/components/ProviderChip";
import { Table, Td, Th } from "@/components/ui/misc";
import { getCommon, getFind } from "@/lib/app";
import { SEARCH_PROVIDERS } from "@/lib/providers";
import { requireAdminPage } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Find companies" };
export const dynamic = "force-dynamic";

export default async function FindPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const common = await getCommon();
  const f = await getFind(sp.t);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-20 font-semibold">Find companies using a technology</h1>
        <p className="text-mute">The reverse lookup. Each provider returns a page of sites that use the technology, not the whole web.</p>
      </div>
      <FindClient providers={SEARCH_PROVIDERS.map((s) => ({ id: s.id, label: s.label, note: s.note }))} runnable={common.hasToken || common.demo} initial={sp.t ?? ""} />
      {f.techs.length > 0 && (
        <nav aria-label="Earlier searches" className="flex flex-wrap gap-1.5">
          {f.techs.map((t) => (
            <a key={t} href={`/find?t=${encodeURIComponent(t)}`} className={`rounded-control border px-2 py-1 text-12 ${t === f.tech ? "border-emerald bg-brand-soft text-link" : "border-line bg-panel text-mute hover:bg-hover"}`}>
              {t}
            </a>
          ))}
        </nav>
      )}
      {f.tech && (
        <section className="rounded-panel border border-line bg-panel" aria-label="Companies">
          <h2 className="border-b border-line p-3 font-semibold">
            {f.hits.length} sites using {f.tech}
          </h2>
          <Table>
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th>Listed by</Th>
                <Th>First seen</Th>
                <Th>Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {f.hits.map((h) => (
                <tr key={h.domain} className="hover:bg-hover">
                  <Td className="num font-medium">{h.domain}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {h.providers.map((p) => (
                        <ProviderChip key={p} id={p} />
                      ))}
                    </div>
                  </Td>
                  <Td className="num text-12 text-mute">{h.firstSeen?.slice(0, 10) ?? "n/a"}</Td>
                  <Td className="num text-12 text-mute">{h.lastSeen?.slice(0, 10) ?? "n/a"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="border-t border-line px-3 py-2 text-12 text-mute">Companies listed by both providers are the strongest matches. Add a domain to the Lookup page to see its full stack.</p>
        </section>
      )}
    </div>
  );
}
