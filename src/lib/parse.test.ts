import { describe, expect, it } from "vitest";
import { isoDate, parseBuiltWithFree, parseBuiltWithFull, parsePredictLeads, parseSearchHits, parseTheirStack, parseTomba, slugOf } from "./parse";

describe("slugOf", () => {
  it("matches spellings of one technology", () => {
    expect(slugOf("React")).toBe("react");
    expect(slugOf("ReactJS")).toBe("react");
    expect(slugOf("React.js")).toBe("react");
    expect(slugOf("Next.js")).toBe("next");
    expect(slugOf("Google Analytics")).toBe("googleanalytics");
    expect(slugOf("Node.js")).toBe("node");
    expect(slugOf("Amazon Web Services")).toBe(slugOf("AWS"));
    expect(slugOf("Office 365")).toBe(slugOf("Microsoft 365"));
  });
});
describe("isoDate", () => {
  it("reads epoch seconds, milliseconds and date strings", () => {
    expect(isoDate(1700000000)).toBe("2023-11-14T22:13:20.000Z");
    expect(isoDate(1700000000000)).toBe("2023-11-14T22:13:20.000Z");
    expect(isoDate("2024-05-01")).toBe("2024-05-01T00:00:00.000Z");
    expect(isoDate("nope")).toBeUndefined();
    expect(isoDate(undefined)).toBeUndefined();
  });
});
describe("provider parsers", () => {
  it("BuiltWith free: category counts and the widest dates, no technologies", () => {
    const p = parseBuiltWithFree({ domain: "a.com", groups: [{ name: "analytics", live: 3, dead: 1, latest: 1750000000000, oldest: 1600000000000 }, { name: "payment", live: 1, dead: 0, latest: 1760000000000, oldest: 1650000000000 }] });
    expect(p.technologies).toEqual([]);
    expect(p.categoryCounts).toEqual([{ name: "Analytics", live: 3, dead: 1 }, { name: "Payment", live: 1, dead: 0 }]);
    expect(p.firstSeen).toBe(new Date(1600000000000).toISOString());
    expect(p.lastSeen).toBe(new Date(1760000000000).toISOString());
  });
  it("BuiltWith full: names, tags, first and last detected, and merges a technology seen on two paths", () => {
    const p = parseBuiltWithFull({ Results: [{ Lookup: "a.com", Result: { Paths: [{ Technologies: [{ Name: "ReactJS", Tag: "javascript", FirstDetected: 1600000000000, LastDetected: 1700000000000 }] }, { Technologies: [{ Name: "ReactJS", Tag: "javascript", FirstDetected: 1500000000000, LastDetected: 1650000000000 }] }] } }] });
    expect(p.technologies).toHaveLength(1);
    expect(p.technologies[0]).toMatchObject({ name: "ReactJS", slug: "react", category: "Javascript", firstSeen: new Date(1500000000000).toISOString(), lastSeen: new Date(1700000000000).toISOString() });
  });
  it("Tomba: names and categories", () => {
    expect(parseTomba({ data: { domain: "a.com", technologies: [{ name: "Stripe", categories: ["Payment"] }, { name: "" }] } }).technologies).toEqual([{ name: "Stripe", slug: "stripe", category: "Payment" }]);
  });
  it("PredictLeads: detections joined to the included technology", () => {
    const p = parsePredictLeads({ data: [{ attributes: { first_seen_at: "2024-01-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z" }, relationships: { technology: { data: { id: "t1" } } } }], included: [{ id: "t1", attributes: { name: "HubSpot" } }] });
    expect(p.technologies[0]).toMatchObject({ name: "HubSpot", category: "Other", firstSeen: "2024-01-01T00:00:00.000Z", lastSeen: "2026-09-01T00:00:00.000Z" });
  });
  it("TheirStack: nested technology, confidence and dates", () => {
    expect(parseTheirStack({ data: [{ technology: { name: "Snowflake", category: "data-warehouse" }, confidence: "high", first_date_found: "2025-01-02", last_date_found: "2026-08-01" }] }).technologies[0]).toMatchObject({ name: "Snowflake", category: "Data warehouse", confidence: "high", firstSeen: "2025-01-02T00:00:00.000Z" });
  });
  it("returns empty results for an empty or odd body", () => {
    for (const f of [parseTomba, parseBuiltWithFull, parsePredictLeads, parseTheirStack, parseBuiltWithFree]) expect(f(null).technologies).toEqual([]);
  });
  it("search bodies: BuiltWith Lists and PredictLeads discover", () => {
    expect(parseSearchHits("builtwith", { Results: [{ D: "www.Acme.com", FD: 1700000000000 }] })).toEqual([{ domain: "acme.com", name: undefined, firstSeen: "2023-11-14T22:13:20.000Z", lastSeen: undefined }]);
    const h = parseSearchHits("predictleads", { data: [{ attributes: {}, relationships: { company: { data: { id: "c1" } } } }], included: [{ id: "c1", attributes: { domain: "beta.io", company_name: "Beta" } }] });
    expect(h[0]).toMatchObject({ domain: "beta.io", name: "Beta" });
  });
});
