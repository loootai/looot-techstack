import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { withFileLock } from "./fileLock";
import { commitState, emptyState, loadState, snapshotState } from "./state";

let dir: string;
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "lock-"));
});

describe("withFileLock", () => {
  it("lets no two holders in at once: 40 read-modify-write cycles lose nothing", async () => {
    const f = join(dir, "n.json");
    writeFileSync(f, "0");
    await Promise.all(
      Array.from({ length: 40 }, () =>
        withFileLock(f, async () => {
          const n = Number(readFileSync(f, "utf8"));
          await new Promise((r) => setTimeout(r, 1));
          writeFileSync(f, String(n + 1));
        }),
      ),
    );
    expect(readFileSync(f, "utf8")).toBe("40");
    expect(existsSync(`${f}.lock`)).toBe(false);
  });

  it("releases the lock when the work throws", async () => {
    const f = join(dir, "x.json");
    await expect(withFileLock(f, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(`${f}.lock`)).toBe(false);
  });

  it("clears a lock left by a dead process", async () => {
    const f = join(dir, "stale.json");
    writeFileSync(`${f}.lock`, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${f}.lock`, old, old);
    await expect(withFileLock(f, async () => "ok")).resolves.toBe("ok");
  });
});

describe("commitState", () => {
  const rec = (domain: string, at: string) => ({ domain, providerId: "tomba", costMicros: 8900, at, status: "ok" as const, data: { technologies: [], categoryCounts: [] } });

  it("merges the answers of two requests that loaded the same file", async () => {
    const path = join(dir, "techstack.json");
    const a = loadState(path);
    const b = loadState(path);
    const sa = snapshotState(a);
    const sb = snapshotState(b);
    a.lookups["tomba|a.com"] = rec("a.com", "2026-10-10T00:00:00.000Z") as never;
    b.lookups["tomba|b.com"] = rec("b.com", "2026-10-10T00:00:01.000Z") as never;
    b.calls.push({ providerId: "tomba", key: "k", costMicros: 8900, status: "completed", at: "2026-10-10T00:00:01.000Z" });
    await Promise.all([commitState(path, a, sa), commitState(path, b, sb)]);
    const out = loadState(path);
    expect(Object.keys(out.lookups).sort()).toEqual(["tomba|a.com", "tomba|b.com"]);
    expect(out.calls).toHaveLength(1);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("starts from an empty file", async () => {
    const path = join(dir, "new", "techstack.json");
    const s = emptyState();
    await commitState(path, s, snapshotState(emptyState()));
    expect(loadState(path).version).toBe(1);
  });
});
