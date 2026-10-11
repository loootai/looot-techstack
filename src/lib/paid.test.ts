import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findTech, lookupText, PaidRequestError, SPEND_REQUESTS_PER_WINDOW } from "./app";
import { resetLimits } from "./auth/limits";

/** A stand-in for api.looot.ai. Counts the paid runs it receives and charges $0.0089 for each. */
let server: Server;
let runs: { endpointId: string; idempotencyKey: string }[] = [];
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "TECHSTACK_DATA", "TECHSTACK_CONFIG", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = body ? (JSON.parse(body) as { endpointId: string; idempotencyKey: string }) : { endpointId: "", idempotencyKey: "" };
      if (req.method === "POST") runs.push({ endpointId: j.endpointId, idempotencyKey: j.idempotencyKey });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ runId: `r${runs.length}`, status: "completed", result: {}, actualCost: 0.0089 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.NEXT_PUBLIC_DEMO;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function fresh(cfg: Record<string, unknown> = {}) {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "paid-"));
  process.env.TECHSTACK_DATA = join(dir, "techstack.json");
  process.env.TECHSTACK_CONFIG = join(dir, "techstack.config.json");
  writeFileSync(process.env.TECHSTACK_CONFIG, JSON.stringify({ providers: ["tomba"], spendCapUsd: 1, cacheDays: 30, ...cfg }));
  runs = [];
  resetLimits();
}
beforeEach(() => fresh());

const TOMBA = 8900;

describe("a paid lookup goes through the quote and the server cap", () => {
  it("refuses a request that carries no quote", async () => {
    await expect(lookupText("a.example", ["tomba"], {})).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/quote first/i) });
    expect(runs).toHaveLength(0);
  });
  it("refuses when the price is above the total the caller was quoted", async () => {
    const err = await lookupText("a.example b.example", ["tomba"], { quoteMicros: TOMBA }).catch((e) => e as PaidRequestError);
    expect(err).toMatchObject({ status: 409 });
    expect(runs).toHaveLength(0);
  });
  it("never spends past the server cap, whatever total the caller sends", async () => {
    fresh({ spendCapUsd: 0.02 });
    const r = await lookupText("c1.example c2.example c3.example c4.example", ["tomba"], { quoteMicros: 999_000_000 });
    expect(runs).toHaveLength(2);
    expect(r.spentMicros).toBeLessThanOrEqual(20_000);
    expect(r.notRun).toBe(2);
  });
  it("is also bounded by the total the caller was quoted", async () => {
    const r = await lookupText("d1.example", ["tomba"], { quoteMicros: TOMBA });
    expect(runs).toHaveLength(1);
    expect(r.quote.totalMicros).toBe(TOMBA);
  });
});

describe("a repeated identical request is not charged twice", () => {
  it("answers the second one from the stored result and calls looot zero more times", async () => {
    const a = await lookupText("e.example", ["tomba"], { quoteMicros: TOMBA });
    expect(runs).toHaveLength(1);
    expect(a.replayed).toBeUndefined();
    const b = await lookupText("E.example", ["tomba"], { quoteMicros: TOMBA });
    expect(runs).toHaveLength(1);
    expect(b.replayed).toBe(true);
    expect(b.spentMicros).toBe(a.spentMicros);
  });
  it("matches the same domains in another order, and is not fooled by a different set", async () => {
    await lookupText("f1.example f2.example", ["tomba"], { quoteMicros: 2 * TOMBA });
    expect(runs).toHaveLength(2);
    const same = await lookupText("f2.example f1.example", ["tomba"], { quoteMicros: 2 * TOMBA });
    expect(same.replayed).toBe(true);
    expect(runs).toHaveLength(2);
    await lookupText("f3.example", ["tomba"], { quoteMicros: TOMBA });
    expect(runs).toHaveLength(3);
  });
  it("replays the same caller key, and refuses that key for a different request", async () => {
    await lookupText("g.example", ["tomba"], { quoteMicros: TOMBA, idempotencyKey: "client-key-0001" });
    const again = await lookupText("g.example", ["tomba"], { quoteMicros: TOMBA, idempotencyKey: "client-key-0001" });
    expect(again.replayed).toBe(true);
    await expect(lookupText("other.example", ["tomba"], { quoteMicros: TOMBA, idempotencyKey: "client-key-0001" })).rejects.toMatchObject({ status: 409 });
    expect(runs).toHaveLength(1);
  });
  it("two identical requests at the same moment pay once", async () => {
    const [a, b] = await Promise.all([lookupText("h.example", ["tomba"], { quoteMicros: TOMBA }), lookupText("h.example", ["tomba"], { quoteMicros: TOMBA })]);
    expect(runs).toHaveLength(1);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
  });
  it("applies to a find too", async () => {
    const a = await findTech("hubspot", ["builtwith"], { quoteMicros: 49_500 });
    expect(a.spentMicros).toBeGreaterThan(0);
    const b = await findTech("HubSpot", ["builtwith"], { quoteMicros: 49_500 });
    expect(b.replayed).toBe(true);
    expect(runs).toHaveLength(1);
  });
});

describe("paid requests are limited per session", () => {
  it("allows the window's worth and then answers 429, and another session still works", async () => {
    for (let i = 0; i < SPEND_REQUESTS_PER_WINDOW; i++) await lookupText(`rl${i}.example`, ["tomba"], { quoteMicros: TOMBA, sid: "s1" });
    await expect(lookupText("rl-over.example", ["tomba"], { quoteMicros: TOMBA, sid: "s1" })).rejects.toMatchObject({ status: 429 });
    await expect(lookupText("rl-other.example", ["tomba"], { quoteMicros: TOMBA, sid: "s2" })).resolves.toBeDefined();
  });
  it("a replay does not count against the limit", async () => {
    await lookupText("rp.example", ["tomba"], { quoteMicros: TOMBA, sid: "s3" });
    for (let i = 0; i < SPEND_REQUESTS_PER_WINDOW + 3; i++) expect((await lookupText("rp.example", ["tomba"], { quoteMicros: TOMBA, sid: "s3" })).replayed).toBe(true);
  });
});
