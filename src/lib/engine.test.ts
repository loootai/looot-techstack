import { describe, expect, it, vi } from "vitest";
import { cacheId, findCompanies, lookupDomains, lookupKey, searchKey } from "./engine";
import type { LoootRun, LoootRunner } from "./looot";
import { mergeDomain } from "./merge";
import { PROVIDERS } from "./providers";
import { buildQuote } from "./quote";

const NOW = new Date("2026-10-10T12:00:00Z");
const P = (id: string) => PROVIDERS.find((p) => p.id === id)!;
const tomba = (names: string[]) => ({ data: { technologies: names.map((name) => ({ name, categories: ["Analytics"] })) } });
const pl = (names: string[]) => ({ data: names.map((n, i) => ({ attributes: { first_seen_at: "2024-01-01" }, relationships: { technology: { data: { id: `t${i}` } } } })), included: names.map((name, i) => ({ id: `t${i}`, attributes: { name } })) });

function runner(fn: (e: string, i: Record<string, unknown>) => Partial<LoootRun>) {
  const calls: [string, Record<string, unknown>, string][] = [];
  const r: LoootRunner & { calls: typeof calls } = { calls, runAndWait: vi.fn(async (e, i, k) => (calls.push([e, i, k]), { runId: "r", status: "completed", actualCost: 0, ...fn(e, i) } as LoootRun)) };
  return r;
}
const base = (looot: LoootRunner, over = {}) => ({ domains: ["a.com"], providers: [P("tomba"), P("predictleads")], looot, cache: {}, cacheDays: 30, capMicros: 1_000_000, now: NOW, ...over });

describe("lookupDomains", () => {
  it("calls every provider once per domain with the right input and a stable key", async () => {
    const looot = runner((e) => (e === "tomba-technology" ? { result: tomba(["Stripe"]), actualCost: 0.0089 } : { result: pl(["Stripe"]), actualCost: 0.01 }));
    const out = await lookupDomains(base(looot));
    expect(looot.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ["tomba-technology", { domain: "a.com" }, lookupKey("tomba", "a.com")],
      ["predictleads-companies-technology-detections", { company_id_or_domain: "a.com", limit: 100 }, lookupKey("predictleads", "a.com")],
    ]);
    expect(out.spentMicros).toBe(18900);
    expect(out.records[cacheId("tomba", "a.com")]).toMatchObject({ status: "ok" });
  });
  it("does not call again for a fresh stored answer, and calls again after cacheDays", async () => {
    const looot = runner(() => ({ result: tomba(["Stripe"]) }));
    const first = await lookupDomains(base(looot, { providers: [P("tomba")] }));
    await lookupDomains(base(looot, { providers: [P("tomba")], cache: first.records }));
    expect(looot.calls).toHaveLength(1);
    await lookupDomains(base(looot, { providers: [P("tomba")], cache: first.records, now: new Date("2026-12-10T00:00:00Z") }));
    expect(looot.calls).toHaveLength(2);
  });
  it("stops before a call that would pass the cap and reports what was not run", async () => {
    const looot = runner(() => ({ result: tomba([]), actualCost: 0.0089 }));
    const out = await lookupDomains(base(looot, { domains: ["a.com", "b.com", "c.com", "d.com"], providers: [P("tomba")], capMicros: 20_000 }));
    expect(looot.calls).toHaveLength(2);
    expect(out.notRun).toEqual([cacheId("tomba", "c.com"), cacheId("tomba", "d.com")]);
  });
  it("stores an unfinished run as pending, a failed one as failed, and keeps going", async () => {
    const looot = runner((e) => (e === "tomba-technology" ? { status: "pending_provider" } : { status: "failed", error: { message: "boom" } }));
    const out = await lookupDomains(base(looot));
    expect(out.records[cacheId("tomba", "a.com")].status).toBe("pending");
    expect(out.records[cacheId("predictleads", "a.com")]).toMatchObject({ status: "failed", error: "boom" });
  });
  it("turns a thrown request error into a failed record", async () => {
    const out = await lookupDomains(base({ runAndWait: async () => { throw new Error("network down"); } }, { providers: [P("tomba")] }));
    expect(out.records[cacheId("tomba", "a.com")].status).toBe("failed");
  });
});

describe("mergeDomain", () => {
  it("shows providers side by side with agreement, dates and pair overlap", async () => {
    const looot = runner((e) => (e === "tomba-technology" ? { result: tomba(["Stripe", "Segment", "ReactJS"]) } : { result: pl(["Stripe", "React", "HubSpot"]) }));
    const out = await lookupDomains(base(looot));
    const m = mergeDomain("a.com", Object.values(out.records));
    const by = Object.fromEntries(m.technologies.map((t) => [t.slug, t]));
    expect(by.stripe).toMatchObject({ providers: ["tomba", "predictleads"], of: 2 });
    expect(by.react.providers).toEqual(["tomba", "predictleads"]);
    expect(by.segment.providers).toEqual(["tomba"]);
    expect(by.hubspot).toMatchObject({ providers: ["predictleads"], firstSeen: "2024-01-01T00:00:00.000Z" });
    expect(m.pairs[0]).toMatchObject({ a: "tomba", b: "predictleads", shared: 2, jaccard: 0.5 });
    expect(m.technologies[0].providers).toHaveLength(2);
  });
  it("does not count the free category answer or a failed provider in the agreement base", async () => {
    const looot = runner((e) => (e === "builtwith-free1-api-json" ? { result: { groups: [{ name: "analytics", live: 2, dead: 0 }] } } : e === "tomba-technology" ? { result: tomba(["Stripe"]) } : { status: "failed" }));
    const out = await lookupDomains(base(looot, { providers: [P("builtwith-free"), P("tomba"), P("predictleads")] }));
    const m = mergeDomain("a.com", Object.values(out.records));
    expect(m.technologies[0]).toMatchObject({ of: 1 });
    expect(m.categoryCounts).toEqual([{ name: "Analytics", live: 2, dead: 0 }]);
    expect(m.failedProviders).toEqual(["predictleads"]);
  });
});

describe("buildQuote", () => {
  it("is exact: domains x providers at list price, minus stored answers", () => {
    const q = buildQuote(["a.com", "b.com"], [P("builtwith-free"), P("tomba"), P("predictleads")], {}, 30, 1_000_000, NOW);
    expect(q.totalMicros).toBe(2 * (0 + 8900 + 10000));
    expect(q.capBinds).toBe(false);
    expect(buildQuote(["a.com"], [P("builtwith"), P("theirstack")], {}, 30, 100_000, NOW)).toMatchObject({ totalMicros: 147_600, capBinds: true });
  });
});

describe("findCompanies", () => {
  it("BuiltWith Lists takes the technology name, with a stable key", async () => {
    const looot = runner(() => ({ result: { Results: [{ D: "acme.com" }, { D: "beta.io" }] }, actualCost: 0.0495 }));
    const out = await findCompanies({ tech: "HubSpot", providerIds: ["builtwith"], looot, cache: {}, cacheDays: 30, capMicros: 1_000_000, now: NOW });
    expect(looot.calls[0]).toEqual(["builtwith-lists12-api-json", { TECH: "HubSpot" }, searchKey("builtwith", "HubSpot")]);
    expect(out.records["builtwith|hubspot"].hits.map((h) => h.domain)).toEqual(["acme.com", "beta.io"]);
  });
  it("PredictLeads resolves the technology first, and a missing technology is a failure, not a charge", async () => {
    const looot = runner((e) => (e === "predictleads-technologies-2" ? { result: { data: [{ id: "tech_9" }] }, actualCost: 0.03 } : { result: { data: [], included: [] }, actualCost: 0.01 }));
    const out = await findCompanies({ tech: "HubSpot", providerIds: ["predictleads"], looot, cache: {}, cacheDays: 30, capMicros: 1_000_000, now: NOW });
    expect(looot.calls[1][1]).toMatchObject({ technology_id: "tech_9" });
    expect(out.spentMicros).toBe(40_000);
    const none = await findCompanies({ tech: "Nope", providerIds: ["predictleads"], looot: runner(() => ({ result: { data: [] } })), cache: {}, cacheDays: 30, capMicros: 1_000_000, now: NOW });
    expect(none.records["predictleads|nope"].status).toBe("failed");
  });
  it("skips a provider whose price would pass the cap", async () => {
    const looot = runner(() => ({ result: {} }));
    const out = await findCompanies({ tech: "X", providerIds: ["builtwith", "predictleads"], looot, cache: {}, cacheDays: 30, capMicros: 45_000, now: NOW });
    expect(out.notRun).toEqual(["builtwith"]);
    expect(looot.calls.length).toBeGreaterThan(0);
  });
});
