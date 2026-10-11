import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lookupText } from "./app";
import { resetLimits } from "./auth/limits";

// These tests use only the app entry points, so they run the same against the code before and after the budget change.
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "TECHSTACK_DATA", "TECHSTACK_CONFIG", "TECHSTACK_DAILY_USD", "TECHSTACK_MONTHLY_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;
let delayMs = 0;
let dir = "";
const TOMBA = 8900;

beforeAll(async () => {
  // A stand-in for api.looot.ai. Every POST is a paid run that costs $0.0089.
  server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") paidRuns++;
      const n = paidRuns;
      setTimeout(() => res.end(JSON.stringify({ runId: `r${n}`, status: "completed", result: {}, actualCost: 0.0089 })), delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LOOOT_TOKEN = "lt_test_token";
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "spend-budget-"));
  process.env.TECHSTACK_DATA = join(dir, "techstack.json");
  process.env.TECHSTACK_CONFIG = join(dir, "techstack.config.json");
  writeFileSync(process.env.TECHSTACK_CONFIG, JSON.stringify({ providers: ["tomba"], spendCapUsd: 1, cacheDays: 30 }));
  delete process.env.TECHSTACK_DAILY_USD;
  delete process.env.TECHSTACK_MONTHLY_USD;
  delete process.env.NEXT_PUBLIC_DEMO;
  paidRuns = 0;
  delayMs = 0;
  resetLimits();
});

const ask = (domain: string, sid = "s1") => lookupText(domain, ["tomba"], { quoteMicros: TOMBA, sid });

describe("the period budget", () => {
  it("stops many small runs at the budget and says which limit it hit", async () => {
    process.env.TECHSTACK_DAILY_USD = "0.03";
    process.env.TECHSTACK_MONTHLY_USD = "0.03";
    // One call reserves $0.0089. Three fit in $0.03, the fourth does not.
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await ask(`small${i}.example`).then((r) => ({ ok: true as const, r }), (e: Error & { status?: number }) => ({ ok: false as const, e })));
    expect(out.filter((o) => o.ok)).toHaveLength(3);
    const refused = out.filter((o) => !o.ok);
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatchObject({ e: { status: 409, message: expect.stringMatching(/budget/i) } });
    expect(paidRuns).toBe(3);
  });

  it("lets only one of two concurrent requests through when their sum is over the budget", async () => {
    process.env.TECHSTACK_DAILY_USD = "0.015";
    process.env.TECHSTACK_MONTHLY_USD = "0.015";
    delayMs = 40;
    const out = await Promise.allSettled([ask("conc-a.example", "s1"), ask("conc-b.example", "s2")]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(paidRuns).toBe(1);
  });

  it("keeps the total charged inside the budget under ten concurrent requests", async () => {
    process.env.TECHSTACK_DAILY_USD = "0.04";
    process.env.TECHSTACK_MONTHLY_USD = "0.04";
    delayMs = 30;
    await Promise.allSettled(Array.from({ length: 10 }, (_, i) => ask(`ten${i}.example`, `s${i}`)));
    expect(paidRuns).toBe(4);
    expect(paidRuns * TOMBA).toBeLessThanOrEqual(40_000);
  });
});

describe("a repeated identical request", () => {
  it("is answered from the stored result, with no second call and no second charge", async () => {
    const a = await ask("same.example");
    expect(paidRuns).toBe(1);
    const b = await ask("same.example");
    expect(paidRuns).toBe(1);
    expect(b.spentMicros).toBe(a.spentMicros);
  });
});

describe("the state file", () => {
  it("keeps the answers of two requests that run at the same time", async () => {
    delayMs = 40;
    await Promise.all([ask("keep-a.example", "s1"), ask("keep-b.example", "s2")]);
    const state = JSON.parse(readFileSync(process.env.TECHSTACK_DATA!, "utf8")) as { lookups: Record<string, { domain: string }> };
    expect(Object.values(state.lookups).map((l) => l.domain).sort()).toEqual(["keep-a.example", "keep-b.example"]);
  });
});
