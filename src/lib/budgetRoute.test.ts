import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as find } from "@/app/api/find/route";
import { POST as lookup } from "@/app/api/lookup/route";
import { resetLimits } from "./auth/limits";
import { CSRF_HEADER, csrfToken, verifySession } from "./auth/session";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "TECHSTACK_DATA", "TECHSTACK_CONFIG", "TECHSTACK_ADMIN_PASSWORD", "TECHSTACK_DAILY_USD", "TECHSTACK_MONTHLY_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;
let failNext = false;
const TOMBA = 8900;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") paidRuns++;
      if (req.method === "POST" && failNext) {
        failNext = false;
        res.statusCode = 400;
        return void res.end(JSON.stringify({ error: { code: "invalid_input", message: "bad domain" } }));
      }
      res.end(JSON.stringify({ runId: `r${paidRuns}`, status: "completed", result: {}, actualCost: 0.0089 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function config(over: Record<string, unknown> = {}) {
  writeFileSync(process.env.TECHSTACK_CONFIG!, JSON.stringify({ providers: ["tomba"], spendCapUsd: 1, cacheDays: 30, ...over }));
}
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-route-"));
  process.env.TECHSTACK_DATA = join(dir, "techstack.json");
  process.env.TECHSTACK_CONFIG = join(dir, "techstack.config.json");
  config();
  process.env.TECHSTACK_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.TECHSTACK_DAILY_USD;
  delete process.env.TECHSTACK_MONTHLY_USD;
  paidRuns = 0;
  failNext = false;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /techstack_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
type Status = { limits: { dailyMicros: number; monthlyMicros: number }; day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };
const read = async (s: S) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as Status;

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const j = await read(await session());
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
    expect(j.day.usedMicros).toBe(0);
    expect(j.day.reservedMicros).toBe(0);
  });

  it("refuses to change the budget without the session", async () => {
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(401);
  });

  it("refuses to change the budget without the CSRF token", async () => {
    const s = await session();
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: { ...H, cookie: s.cookie }, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(403);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    expect((await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s)).status).toBe(200);
    expect((await read(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });

  it("rejects a daily budget above the monthly one", async () => {
    const s = await session();
    expect((await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 9, monthlyUsd: 3 }, s)).status).toBe(400);
  });
});

describe("the caller cannot set the cap or the budget", () => {
  it("refuses a lookup that carries a budget and calls nothing", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const res = await call(lookup, "POST", "/api/lookup", { text: "a1.example", providers: ["tomba"], quoteMicros: TOMBA, dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
    expect((await read(s)).limits.dailyMicros).toBe(1_000);
  });

  it("refuses a find that carries a budget", async () => {
    const s = await session();
    const res = await call(find, "POST", "/api/find", { tech: "react", providers: ["builtwith"], quoteMicros: 49_500, monthlyUsd: 1e9 }, s);
    expect(res.status).toBe(400);
    expect(paidRuns).toBe(0);
  });

  it("ignores a cap sent in the request: the server cap still stops the run", async () => {
    config({ spendCapUsd: 0.02 });
    const s = await session();
    const res = await call(lookup, "POST", "/api/lookup", { text: "c1.example c2.example c3.example c4.example", providers: ["tomba"], quoteMicros: 999_000_000, capUsd: 999, spendCapUsd: 999, capMicros: 999_000_000, cap: 999 }, s);
    expect(res.status).toBe(200);
    expect(paidRuns).toBe(2);
    expect(((await res.json()) as { notRun: number }).notRun).toBe(2);
  });
});

describe("the budget over a run", () => {
  it("refuses a lookup above the owner's budget even when the caller sends a large quote total", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.005, monthlyUsd: 0.005 }, s);
    const res = await call(lookup, "POST", "/api/lookup", { text: "d1.example", providers: ["tomba"], quoteMicros: 999_000_000 }, s);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
  });

  it("counts a finished run as used and leaves nothing reserved", async () => {
    const s = await session();
    expect((await call(lookup, "POST", "/api/lookup", { text: "e1.example", providers: ["tomba"], quoteMicros: TOMBA }, s)).status).toBe(200);
    const j = await read(s);
    expect(j.day.usedMicros).toBe(TOMBA);
    expect(j.day.reservedMicros).toBe(0);
    expect(j.day.remainingMicros).toBe(j.day.limitMicros - TOMBA);
  });

  it("gives the reservation back when looot refuses the call", async () => {
    const s = await session();
    failNext = true;
    await call(lookup, "POST", "/api/lookup", { text: "f1.example", providers: ["tomba"], quoteMicros: TOMBA }, s);
    const j = await read(s);
    expect(j.day.reservedMicros).toBe(0);
    expect(j.day.usedMicros).toBe(0);
  });

  it("does not charge a repeated identical request twice", async () => {
    const s = await session();
    const body = { text: "g1.example", providers: ["tomba"], quoteMicros: TOMBA };
    expect((await call(lookup, "POST", "/api/lookup", body, s)).status).toBe(200);
    expect((await call(lookup, "POST", "/api/lookup", body, s)).status).toBe(200);
    expect(paidRuns).toBe(1);
    expect((await read(s)).day.usedMicros).toBe(TOMBA);
  });
});
