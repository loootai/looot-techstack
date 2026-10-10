import { describe, expect, it } from "vitest";
import { normalizeDomain, parseDomains } from "./domain";

describe("domains", () => {
  it("normalises URLs and hosts", () => {
    expect(normalizeDomain("https://www.Stripe.com/pricing?x=1")).toBe("stripe.com");
    expect(normalizeDomain("app.example.co.uk:8080/x")).toBe("app.example.co.uk");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
  });
  it("parses lines, commas and a CSV with a header, dedupes, and reports invalid values", () => {
    expect(parseDomains("stripe.com\nhttps://www.hubspot.com/x\nstripe.com, bad value").domains).toEqual(["stripe.com", "hubspot.com"]);
    expect(parseDomains("domain,name\nstripe.com,Stripe\nlinear.app,Linear").domains).toEqual(["stripe.com", "linear.app"]);
    expect(parseDomains("\ndomain\nstripe.com").invalid).toEqual([]);
    expect(parseDomains("a.com b.com;c.com").domains).toEqual(["a.com", "b.com", "c.com"]);
    expect(parseDomains("stripe.com\nnonsense").invalid).toEqual(["nonsense"]);
  });
});
