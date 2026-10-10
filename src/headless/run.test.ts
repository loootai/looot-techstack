import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DemoRunner } from "@/demo/fixtureRunner";
import type { LoootRunner } from "@/lib/looot";
import { runCli } from "./run";

const NOW = new Date("2026-10-10T12:00:00Z");
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "techstack-test-"));
  const file = join(dir, "domains.txt");
  writeFileSync(file, "brightloop.example\nhttps://www.orbitpay.example/\nnot a domain\n");
  const out: string[] = [];
  const err: string[] = [];
  const demo = new DemoRunner();
  const looot: LoootRunner = { runAndWait: vi.fn((e, i) => demo.runAndWait(e, i)) };
  const deps = { env: {}, out: (s: string) => out.push(s), err: (s: string) => err.push(s), now: NOW, looot };
  const args = (...more: string[]) => ["--domains", file, "--out", join(dir, "out"), "--state", join(dir, "state.json"), "--config", join(dir, "none.json"), ...more];
  return { dir, out, err, looot, deps, args };
}

describe("runCli", () => {
  it("--dry-run prints the exact list-price cost, makes no call and writes nothing", async () => {
    const t = setup();
    expect(await runCli(t.args("--dry-run"), t.deps)).toBe(0);
    expect(t.looot.runAndWait).not.toHaveBeenCalled();
    expect(t.out.join("\n")).toContain("Total: $0.04");
    expect(existsSync(join(t.dir, "out"))).toBe(false);
  });
  it("runs, writes json, csv and markdown with agreement, and a second run is free", async () => {
    const t = setup();
    expect(await runCli(t.args("--providers", "builtwith-free,tomba,predictleads,builtwith", "--find", "HubSpot"), t.deps)).toBe(0);
    const json = JSON.parse(readFileSync(join(t.dir, "out", "techstack.json"), "utf8"));
    expect(json.domains).toHaveLength(2);
    expect(json.find.hits.map((h: { domain: string }) => h.domain)).toContain("brightloop.example");
    expect(readFileSync(join(t.dir, "out", "techstack.csv"), "utf8")).toContain('"brightloop.example","Stripe"');
    expect(readFileSync(join(t.dir, "out", "techstack.md"), "utf8")).toContain("Overlap between providers");
    const n = (t.looot.runAndWait as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(await runCli(t.args("--providers", "builtwith-free,tomba,predictleads,builtwith", "--find", "HubSpot"), t.deps)).toBe(0);
    expect((t.looot.runAndWait as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n);
  });
  it("stops at --cap and says so", async () => {
    const t = setup();
    await runCli(t.args("--cap", "0.01"), t.deps);
    expect(t.out.join("\n")).toContain("Stopped at the $0.01 cap");
  });
  it("exits 2 without LOOOT_TOKEN or without input", async () => {
    const t = setup();
    expect(await runCli(t.args(), { ...t.deps, looot: undefined })).toBe(2);
    expect(await runCli([], t.deps)).toBe(2);
  });
});
