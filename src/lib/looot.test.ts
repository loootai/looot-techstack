import { describe, expect, it, vi } from "vitest";
import { ConfigSchema, DEFAULT_CONFIG } from "./config";
import { LoootClient, LoootError, loootFromEnv } from "./looot";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("LoootClient", () => {
  it("posts endpoint, input, idempotency key and the bearer token", async () => {
    const f = vi.fn(async () => json({ runId: "r", status: "completed", result: {}, actualCost: 0.0089 }));
    const client = new LoootClient({ token: "tok_test", fetch: f as unknown as typeof fetch });
    await client.run("tomba-technology", { domain: "stripe.com" }, "techstack:tomba:stripe.com");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.looot.ai/v1/runs?wait=30");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_test");
    expect(JSON.parse(init.body as string)).toEqual({ endpointId: "tomba-technology", input: { domain: "stripe.com" }, idempotencyKey: "techstack:tomba:stripe.com" });
  });
  it("polls an unfinished run, hands back one still unfinished at the timeout, and throws LoootError on HTTP errors", async () => {
    const answers = [json({ runId: "r", status: "running" }), json({ runId: "r", status: "completed" })];
    const client = new LoootClient({ token: "t", fetch: (async () => answers.shift()!) as unknown as typeof fetch, sleep: async () => {} });
    expect((await client.runAndWait("e", {}, "k")).status).toBe("completed");
    const slow = new LoootClient({ token: "t", fetch: (async () => json({ runId: "r", status: "queued" })) as unknown as typeof fetch, sleep: async () => {}, pollTimeoutMs: 0 });
    expect((await slow.runAndWait("e", {}, "k")).status).toBe("queued");
    const bad = new LoootClient({ token: "t", fetch: (async () => json({ error: { code: "insufficient_funds", message: "Top up" } }, 402)) as unknown as typeof fetch });
    await expect(bad.run("e", {}, "k")).rejects.toMatchObject({ status: 402, code: "insufficient_funds" });
    expect(() => loootFromEnv({})).toThrow(LoootError);
  });
});

describe("config", () => {
  it("defaults to the three cheap providers and rejects an unknown provider id", () => {
    expect(DEFAULT_CONFIG.providers).toEqual(["builtwith-free", "tomba", "predictleads"]);
    expect(() => ConfigSchema.parse({ providers: ["wappalyzer"] })).toThrow();
  });
});
