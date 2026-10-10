import type { LoootRun, LoootRunner } from "@/lib/looot";
import { PROVIDERS } from "@/lib/providers";
import { slugOf } from "@/lib/parse";

/**
 * Made-up stacks for made-up domains. Each row is name|category|first seen|last seen|providers,
 * where the letters are the providers that "detect" it: t Tomba, p PredictLeads, b BuiltWith, s TheirStack.
 * BuiltWith spells some names differently on purpose, to show the matching.
 */
const STACKS: Record<string, string[]> = {
  "brightloop.example": [
    "React|JavaScript frameworks|2021-03-02|2026-09-30|tpbs",
    "Next.js|JavaScript frameworks|2022-06-11|2026-09-30|tpb",
    "Vercel|Hosting|2022-06-11|2026-09-30|pb",
    "Stripe|Payment|2020-01-15|2026-09-29|tpbs",
    "HubSpot|Marketing automation|2021-09-01|2026-09-30|tpbs",
    "Segment|Analytics|2021-09-01|2026-08-12|tb",
    "Google Analytics|Analytics|2019-11-04|2026-09-30|tpb",
    "Intercom|Customer support|2022-02-20|2026-09-27|tp",
    "Salesforce|CRM|2023-04-18|2026-09-01|s",
    "Cloudflare|CDN|2020-05-05|2026-09-30|tpb",
  ],
  "harborfinch.example": [
    "WordPress|CMS|2018-07-10|2026-09-30|tpb",
    "Google Tag Manager|Tag management|2019-02-02|2026-09-30|tpb",
    "Google Analytics|Analytics|2018-07-10|2026-09-30|tpb",
    "Mailchimp|Email|2020-10-10|2026-09-15|tp",
    "Microsoft 365|Productivity|2021-01-12|2026-09-30|ps",
    "Hotjar|Analytics|2022-11-03|2026-07-02|b",
  ],
  "kestrellogistics.example": [
    "Microsoft 365|Productivity|2019-05-05|2026-09-30|tps",
    "Salesforce|CRM|2020-08-14|2026-09-30|tpbs",
    "AWS|Hosting|2021-02-02|2026-09-30|tpb",
    "Zendesk|Customer support|2022-03-03|2026-09-20|tb",
    "Drift|Chat|2023-01-09|2025-12-01|p",
  ],
  "orbitpay.example": [
    "React|JavaScript frameworks|2021-07-07|2026-09-30|tpbs",
    "Stripe|Payment|2021-07-07|2026-09-30|tpbs",
    "AWS|Hosting|2021-07-07|2026-09-30|tpb",
    "Amplitude|Analytics|2022-09-09|2026-09-30|tp",
    "Segment|Analytics|2022-09-09|2026-09-30|tpb",
    "HubSpot|Marketing automation|2023-05-05|2026-09-30|ps",
    "Intercom|Customer support|2023-05-05|2026-09-30|tpb",
  ],
  "lumenretail.example": [
    "Shopify|Ecommerce|2019-10-10|2026-09-30|tpbs",
    "Google Analytics|Analytics|2019-10-10|2026-09-30|tpb",
    "Mailchimp|Email|2020-03-03|2026-09-30|tpb",
    "Hotjar|Analytics|2021-06-06|2026-09-30|tb",
    "Cloudflare|CDN|2022-01-01|2026-09-30|pb",
  ],
  "pinevalley.example": [
    "WordPress|CMS|2017-04-04|2026-09-30|tpb",
    "Microsoft 365|Productivity|2020-09-09|2026-09-30|tp",
    "Google Tag Manager|Tag management|2019-01-01|2026-09-30|tpb",
    "Zoom|Video conferencing|2020-04-01|2026-09-30|p",
  ],
};

interface Row {
  name: string;
  category: string;
  first: string;
  last: string;
  by: string;
}
const rows = (domain: string): Row[] => (STACKS[domain] ?? []).map((l) => {
  const [name, category, first, last, by] = l.split("|");
  return { name, category, first, last, by };
});

/** BuiltWith writes some names its own way. */
const BW_NAME: Record<string, string> = { React: "ReactJS", "Next.js": "Next.js", AWS: "Amazon Web Services", "Microsoft 365": "Office 365" };

const ms = (d: string) => new Date(d).getTime();
const cost = (endpointId: string) => (PROVIDERS.find((p) => p.endpointId === endpointId)?.priceMicros ?? 0) / 1_000_000;
const done = (n: number, endpointId: string, result: unknown): LoootRun => ({ runId: `demo_${n}`, status: "completed", result, actualCost: cost(endpointId) });

const EXTRA = ["fernwood-labs.example", "gullcove.example", "tidewater-hr.example", "quarry-and-co.example"];

/** Stands in for looot in demo mode and UI tests. Never makes a network call. */
export class DemoRunner implements LoootRunner {
  calls = 0;
  async runAndWait(endpointId: string, input: Record<string, unknown>): Promise<LoootRun> {
    const n = ++this.calls;
    const domain = String(input.domain ?? input.LOOKUP ?? input.company_id_or_domain ?? input.company_domain ?? "");
    const rs = rows(domain);
    const has = (r: Row, l: string) => r.by.includes(l);
    switch (endpointId) {
      case "builtwith-free1-api-json": {
        if (rs.length === 0) return { runId: `demo_${n}`, status: "failed", error: { code: "not_found", message: "No data for this domain" }, actualCost: 0 };
        const by = new Map<string, Row[]>();
        for (const r of rs) by.set(r.category, [...(by.get(r.category) ?? []), r]);
        return done(n, endpointId, { domain, categories: [...by].map(([name, list]) => ({ name, live: list.length, dead: 0, latest: ms(list.map((r) => r.last).sort().at(-1)!), oldest: ms(list.map((r) => r.first).sort()[0]) })) });
      }
      case "tomba-technology":
        return done(n, endpointId, { data: { domain, technologies: rs.filter((r) => has(r, "t")).map((r) => ({ name: r.name, categories: [r.category], website: `https://${slugOf(r.name)}.example` })) } });
      case "predictleads-companies-technology-detections": {
        const list = rs.filter((r) => has(r, "p"));
        return done(n, endpointId, {
          data: list.map((r, i) => ({ id: `det_${i}`, type: "technology_detection", attributes: { first_seen_at: `${r.first}T00:00:00Z`, last_seen_at: `${r.last}T00:00:00Z`, behind_firewall: false }, relationships: { technology: { data: { id: `tech_${slugOf(r.name)}`, type: "technology" } } } })),
          included: list.map((r) => ({ id: `tech_${slugOf(r.name)}`, type: "technology", attributes: { name: r.name, category: r.category } })),
        });
      }
      case "builtwith-api-json":
        return done(n, endpointId, { Results: [{ Lookup: domain, Result: { Paths: [{ Technologies: rs.filter((r) => has(r, "b")).map((r) => ({ Name: BW_NAME[r.name] ?? r.name, Tag: r.category, FirstDetected: ms(r.first), LastDetected: ms(r.last) })) }] } }] });
      case "theirstack-companies-technologies":
        return done(n, endpointId, { data: rs.filter((r) => has(r, "s")).map((r) => ({ technology: { name: r.name, category: r.category }, confidence: "high", jobs: 3, first_date_found: r.first, last_date_found: r.last })) });
      case "builtwith-lists12-api-json": {
        const slug = slugOf(String(input.TECH ?? ""));
        const hits = Object.keys(STACKS).filter((d) => rows(d).some((r) => slugOf(BW_NAME[r.name] ?? r.name) === slug && has(r, "b")));
        return done(n, endpointId, { Results: [...hits, ...EXTRA.slice(0, 2)].map((D, i) => ({ D, FD: ms("2024-01-01") + i * 86_400_000, LD: ms("2026-09-30") })) });
      }
      case "predictleads-technologies-2":
        return { runId: `demo_${n}`, status: "completed", result: { data: [{ id: `tech_${slugOf(String(input.technology_id_or_name))}`, type: "technology" }] }, actualCost: 0.03 };
      case "predictleads-discover-technologies-technology-detections": {
        const slug = String(input.technology_id ?? "").replace(/^tech_/, "");
        const hits = Object.keys(STACKS).filter((d) => rows(d).some((r) => slugOf(r.name) === slug && has(r, "p")));
        const all = [...hits, ...EXTRA.slice(1, 4)];
        return done(n, endpointId, { data: all.map((d, i) => ({ id: `d${i}`, type: "technology_detection", attributes: { first_seen_at: "2024-06-01T00:00:00Z", last_seen_at: "2026-09-29T00:00:00Z" }, relationships: { company: { data: { id: `c${i}`, type: "company" } } } })), included: all.map((d, i) => ({ id: `c${i}`, type: "company", attributes: { domain: d, company_name: d.split(".")[0] } })) });
      }
      default:
        return { runId: `demo_${n}`, status: "failed", error: { code: "unknown_endpoint", message: endpointId }, actualCost: 0 };
    }
  }
}

export const DEMO_DOMAINS = Object.keys(STACKS);
