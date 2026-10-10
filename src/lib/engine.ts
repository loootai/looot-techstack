import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { parseSearchHits, slugOf } from "./parse";
import { providerById, SEARCH_PROVIDERS, type Provider, type SearchProviderId } from "./providers";
import type { CallRecord, LookupRecord, SearchRecord } from "./types";

const PENDING = new Set(["queued", "running", "reconciliation_pending", "pending_provider"]);
const BATCH = 5;

/** Stable per (input, provider): the same pair always has the same key, so a retry never pays twice. */
export const lookupKey = (providerId: string, domain: string, salt = "") => `techstack:${providerId}:${domain}${salt}`;
export const searchKey = (providerId: string, tech: string, salt = "") => `techstack:find:${providerId}:${slugOf(tech)}${salt}`;

export const cacheId = (providerId: string, domain: string) => `${providerId}|${domain}`;

/** true when a stored answer can be reused: finished and younger than cacheDays. */
export function isFresh(r: { status: string; at: string } | undefined, cacheDays: number, now: Date): boolean {
  return Boolean(r && r.status === "ok" && now.getTime() - new Date(r.at).getTime() < cacheDays * 86_400_000);
}

async function call(looot: LoootRunner, endpointId: string, input: Record<string, unknown>, key: string): Promise<LoootRun> {
  try {
    return await looot.runAndWait(endpointId, input, key);
  } catch (e) {
    return { runId: "", status: "failed", error: { code: e instanceof LoootError ? (e.code ?? "request_failed") : "request_failed", message: (e as Error).message } };
  }
}

export interface LookupInput {
  domains: string[];
  providers: Provider[];
  looot: LoootRunner;
  cache: Record<string, LookupRecord>;
  cacheDays: number;
  capMicros: number;
  now: Date;
}
export interface LookupOutput {
  records: Record<string, LookupRecord>;
  calls: CallRecord[];
  spentMicros: number;
  /** domain|provider pairs not run because the next call would pass the cap. */
  notRun: string[];
}

/**
 * Calls each provider once per domain, skipping fresh stored answers, and stops before a call
 * that would pass the cap. A run still in progress is stored as pending, never as failed.
 */
export async function lookupDomains(input: LookupInput): Promise<LookupOutput> {
  const records = { ...input.cache };
  const calls: CallRecord[] = [];
  const notRun: string[] = [];
  const at = input.now.toISOString();
  let spent = 0;
  const todo: { domain: string; p: Provider }[] = [];
  for (const domain of input.domains) for (const p of input.providers) if (!isFresh(records[cacheId(p.id, domain)], input.cacheDays, input.now)) todo.push({ domain, p });

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    let reserve = 0;
    let fit = 0;
    for (const t of chunk) {
      if (spent + reserve + t.p.priceMicros > input.capMicros) break;
      reserve += t.p.priceMicros;
      fit++;
    }
    const batch = chunk.slice(0, fit);
    const runs = await Promise.all(batch.map((t) => call(input.looot, t.p.endpointId, t.p.input(t.domain), lookupKey(t.p.id, t.domain))));
    batch.forEach((t, n) => {
      const run = runs[n];
      const cost = toMicros(run.actualCost);
      spent += cost;
      const key = lookupKey(t.p.id, t.domain);
      calls.push({ providerId: t.p.id, key, costMicros: cost, status: run.status, at });
      const base = { domain: t.domain, providerId: t.p.id, costMicros: cost, at };
      if (run.status === "completed") records[cacheId(t.p.id, t.domain)] = { ...base, status: "ok", data: t.p.parse(run.result) };
      else if (PENDING.has(run.status)) records[cacheId(t.p.id, t.domain)] = { ...base, status: "pending" };
      else records[cacheId(t.p.id, t.domain)] = { ...base, status: "failed", error: run.error?.message ?? run.status };
    });
    if (fit < chunk.length) {
      notRun.push(...todo.slice(i + fit).map((t) => cacheId(t.p.id, t.domain)));
      break;
    }
  }
  return { records, calls, spentMicros: spent, notRun };
}

export interface SearchInput {
  tech: string;
  providerIds: SearchProviderId[];
  looot: LoootRunner;
  cache: Record<string, SearchRecord>;
  cacheDays: number;
  capMicros: number;
  now: Date;
  limit?: number;
}

export const searchCacheId = (providerId: string, tech: string) => `${providerId}|${slugOf(tech)}`;

/** "Find companies using X" through each chosen provider. Cap checked before each provider. */
export async function findCompanies(input: SearchInput): Promise<{ records: Record<string, SearchRecord>; calls: CallRecord[]; spentMicros: number; notRun: string[] }> {
  const records = { ...input.cache };
  const calls: CallRecord[] = [];
  const notRun: string[] = [];
  const at = input.now.toISOString();
  let spent = 0;
  for (const id of input.providerIds) {
    const sp = SEARCH_PROVIDERS.find((s) => s.id === id);
    if (!sp) continue;
    const id2 = searchCacheId(id, input.tech);
    if (isFresh(records[id2], input.cacheDays, input.now)) continue;
    if (spent + sp.priceMicros > input.capMicros) {
      notRun.push(id);
      continue;
    }
    const key = searchKey(id, input.tech);
    let cost = 0;
    let run: LoootRun;
    if (id === "builtwith") run = await call(input.looot, sp.endpointId, { TECH: input.tech }, key);
    else {
      // PredictLeads wants a technology id. Resolve the name first, then list its detections.
      const resolved = await call(input.looot, "predictleads-technologies-2", { technology_id_or_name: input.tech }, `${key}:resolve`);
      cost += toMicros(resolved.actualCost);
      const techId = resolved.status === "completed" ? firstId(resolved.result) : undefined;
      run = techId ? await call(input.looot, sp.endpointId, { technology_id: techId, limit: input.limit ?? 100 }, key) : { runId: "", status: PENDING.has(resolved.status) ? resolved.status : "failed", error: { message: "The technology was not found" } };
    }
    cost += toMicros(run.actualCost);
    spent += cost;
    calls.push({ providerId: id, key, costMicros: cost, status: run.status, at });
    const base = { tech: input.tech, providerId: id, costMicros: cost, at };
    if (run.status === "completed") records[id2] = { ...base, status: "ok", hits: parseSearchHits(id, run.result).map((h) => ({ ...h, providers: [id] })) };
    else if (PENDING.has(run.status)) records[id2] = { ...base, status: "pending", hits: [] };
    else records[id2] = { ...base, status: "failed", error: run.error?.message ?? run.status, hits: [] };
  }
  return { records, calls, spentMicros: spent, notRun };
}

function firstId(body: unknown): string | undefined {
  const b = body as { data?: unknown } | null;
  const d = Array.isArray(b?.data) ? (b!.data as { id?: unknown }[])[0] : (b?.data as { id?: unknown } | undefined);
  const id = d?.id ?? (body as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

export { providerById };
