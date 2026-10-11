import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, budgetFieldError, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { callFingerprint, findCompanies, lookupDomains, lookupKey, periodOf } from "./engine";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { PROVIDERS } from "./providers";

const now = new Date("2026-10-10T09:00:00Z");
const tomba = PROVIDERS.find((p) => p.id === "tomba")!;
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number) => LoootRun | Promise<LoootRun>) {
  const calls: string[] = [];
  const looot: LoootRunner = {
    async runAndWait(endpointId, _input, key) {
      calls.push(key);
      return answer(calls.length);
    },
  };
  return { looot, calls };
}
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: {}, actualCost: cost });
const lookup = (looot: LoootRunner, ledger: Budget, domains: string[], over: Record<string, unknown> = {}) => lookupDomains({ domains, providers: [tomba], looot, cache: {}, cacheDays: 30, capMicros: 5_000_000, now, ledger, ...over });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });

  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });

  it("flags a request body that carries a budget", () => {
    expect(budgetFieldError({ text: "a.example" })).toBeNull();
    expect(budgetFieldError({ dailyUsd: 1e9 })).toMatch(/budget/i);
    expect(budgetFieldError({ limits: { dailyMicros: 1 } })).toMatch(/budget/i);
    expect(budgetFieldError(null)).toBeNull();
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("lookupDomains with the budget", () => {
  it("does not charge a repeated identical request twice, even with an empty state", async () => {
    const b = open();
    const first = runner(() => completed(0.0089));
    const r1 = await lookup(first.looot, b, ["a.com", "b.com"]);
    const second = runner(() => completed(0.0089));
    const r2 = await lookup(second.looot, b, ["a.com", "b.com"]);
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(0);
    expect(r2.spentMicros).toBe(0);
    expect(r2.records["tomba|a.com"].status).toBe("ok");
    expect((await b.status(now)).day.usedMicros).toBe(r1.spentMicros);
  });

  it("answers two identical requests started together with one charge", async () => {
    const slow = () => runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.0089); });
    const a = slow();
    const c = slow();
    await Promise.all([lookup(a.looot, open(), ["a.com"]), lookup(c.looot, open(), ["a.com"])]);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(8_900);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("skips calls that would pass the budget and says so", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 20_000, monthlyMicros: 20_000 });
    const { looot, calls } = runner(() => completed(0.0089));
    const out = await lookup(looot, b, ["a.com", "b.com", "c.com", "d.com"]);
    expect(calls).toHaveLength(2);
    expect(out.skippedByBudget).toBe(2);
    expect(out.budgetMessage).toMatch(/budget/i);
    expect(out.notRun).toEqual(["tomba|c.com", "tomba|d.com"]);
  });

  it("keeps the reservation of a pending call and never records it as failed at zero", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const out = await lookup(looot, b, ["a.com"]);
    expect(out.records["tomba|a.com"].status).toBe("pending");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(8_900);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a pending call that completes later and stores its answer", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    await lookup(looot, b, ["a.com"]);
    await b.reconcile({ getRun: async () => completed(0.0089) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(8_900);
    const stored = await b.recall(lookupKey("tomba", "a.com", periodOf(now, 30)), callFingerprint(tomba.endpointId, tomba.input("a.com")), now);
    expect(stored?.status).toBe("completed");
  });

  it("releases the reservation of a call that looot refused", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const out = await lookup(looot, b, ["a.com"]);
    expect(out.records["tomba|a.com"].status).toBe("failed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await lookup(looot, b, ["a.com"]);
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await lookup(looot, b, ["a.com"]);
    expect((await b.status(now)).day.reservedMicros).toBe(8_900);
  });

  it("does not reserve for a free provider", async () => {
    const b = open();
    const free = PROVIDERS.find((p) => p.id === "builtwith-free")!;
    const { looot } = runner(() => completed(0));
    await lookupDomains({ domains: ["a.com"], providers: [free], looot, cache: {}, cacheDays: 30, capMicros: 1_000_000, now, ledger: b });
    expect((await b.status(now)).reservations).toBe(0);
  });
});

describe("findCompanies with the budget", () => {
  it("reserves and settles the resolve step and the list step as two calls", async () => {
    const b = open();
    const seen: string[] = [];
    const looot: LoootRunner = {
      async runAndWait(endpointId) {
        seen.push(endpointId);
        return endpointId === "predictleads-technologies-2" ? { runId: "r1", status: "completed", result: { data: [{ id: "t1" }] }, actualCost: 0.03 } : { runId: "r2", status: "completed", result: { data: [] }, actualCost: 0.01 };
      },
    };
    const out = await findCompanies({ tech: "hubspot", providerIds: ["predictleads"], looot, cache: {}, cacheDays: 30, capMicros: 1_000_000, now, ledger: b });
    expect(seen).toHaveLength(2);
    expect(out.spentMicros).toBe(40_000);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(40_000);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("refuses a search the budget cannot pay for and calls nothing", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 10_000, monthlyMicros: 10_000 });
    const { looot, calls } = runner(() => completed(0.0495));
    const out = await findCompanies({ tech: "hubspot", providerIds: ["builtwith"], looot, cache: {}, cacheDays: 30, capMicros: 1_000_000, now, ledger: b });
    expect(calls).toHaveLength(0);
    expect(out.notRun).toEqual(["builtwith"]);
    expect(out.skippedByBudget).toBe(1);
  });
});

describe("stable idempotency keys", () => {
  it("has no date in it and only changes when the cache period rolls over", () => {
    const day1 = periodOf(new Date("2026-10-10T00:00:00Z"), 30);
    const day2 = periodOf(new Date("2026-10-11T23:59:00Z"), 30);
    expect(day1).toBe(day2);
    expect(lookupKey("tomba", "a.com", day1)).toBe(lookupKey("tomba", "a.com", day2));
    expect(lookupKey("tomba", "a.com", day1)).not.toMatch(/2026|T\d\d/);
    // A stored answer is stale after cacheDays, which is at least one period later, so the key differs and buys fresh data.
    const stale = periodOf(new Date(new Date("2026-10-10T00:00:00Z").getTime() + 30 * 86_400_000), 30);
    expect(stale).toBeGreaterThan(day1);
  });

  it("is the same for the same call whatever the case and key order", () => {
    expect(callFingerprint("e", { a: "X ", b: 1 })).toBe(callFingerprint("e", { b: 1, a: "x" }));
    expect(callFingerprint("e", { a: "x" })).not.toBe(callFingerprint("e2", { a: "x" }));
  });
});

describe("the budget file", () => {
  it("is written whole: a reader never sees a half file", async () => {
    const b = open();
    await Promise.all(Array.from({ length: 20 }, (_, i) => b.reserve(`k${i}`, 1, now)));
    expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
  });
});
