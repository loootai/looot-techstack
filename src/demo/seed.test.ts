import { describe, expect, it } from "vitest";
import { resultsFor, searchHits } from "@/lib/service";
import { buildDemoState } from "./seed";

describe("demo state", () => {
  it("runs the real engine over made-up domains and shows provider disagreement", async () => {
    const s = await buildDemoState(new Date("2026-10-10T12:00:00Z"));
    const [r] = resultsFor(s, ["brightloop.example"]);
    expect(r.listProviders).toEqual(["tomba", "predictleads", "builtwith"]);
    expect(r.technologies.find((t) => t.slug === "react")).toMatchObject({ providers: ["tomba", "predictleads", "builtwith"], of: 3 });
    expect(r.technologies.find((t) => t.slug === "intercom")?.providers).toEqual(["tomba", "predictleads"]);
    expect(r.technologies.find((t) => t.slug === "salesforce")).toBeUndefined();
    const aws = resultsFor(s, ["kestrellogistics.example"])[0].technologies.find((t) => t.slug === "aws");
    expect(aws?.providers).toEqual(["tomba", "predictleads", "builtwith"]);
  });
  it("seeds a find-companies search from both providers", async () => {
    const s = await buildDemoState();
    const hits = searchHits(s, "HubSpot");
    expect(hits.find((h) => h.domain === "brightloop.example")?.providers).toEqual(["builtwith", "predictleads"]);
  });
});
