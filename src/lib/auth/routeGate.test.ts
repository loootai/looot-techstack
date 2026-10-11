import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Every API route handler is found on disk, not listed by hand, so a new route with no gate fails here.
 * With an admin password set and no session cookie, each admin handler must answer 401.
 */
const PUBLIC_API = new Set(["/api/health", "/api/auth/login", "/api/auth/logout"]);

const modules = import.meta.glob("/src/app/api/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const routeOf = (file: string) => file.replace("/src/app", "").replace(/\/route\.ts$/, "");

beforeAll(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "gate-"));
  process.env.TECHSTACK_DATA = join(dir, "techstack.json");
  process.env.TECHSTACK_CONFIG = join(dir, "techstack.config.json");
  process.env.TECHSTACK_ADMIN_PASSWORD = "test-password-123456";
  delete process.env.NEXT_PUBLIC_DEMO;
});

describe("admin API handlers refuse a request with no session", () => {
  const admin = Object.keys(modules).filter((f) => !PUBLIC_API.has(routeOf(f)));
  it("finds the admin routes", () => expect(admin.length).toBeGreaterThanOrEqual(4));
  for (const file of admin) {
    it(`${routeOf(file)} answers 401 for every method it exports`, async () => {
      const mod = await modules[file]();
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function");
      expect(methods.length).toBeGreaterThan(0);
      for (const m of methods) {
        const init: RequestInit = m === "GET" ? { method: m } : { method: m, headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ text: "example.com", tech: "react" }) };
        const res = await (mod[m] as (r: Request) => Promise<Response>)(new Request(`http://localhost${routeOf(file)}`, init));
        expect(res.status, `${m} ${routeOf(file)}`).toBe(401);
      }
    });
  }
});
