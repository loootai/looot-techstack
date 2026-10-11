import { createHash } from "node:crypto";
import type { Ledger } from "./budget";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { parseSearchHits, slugOf } from "./parse";
import { providerById, SEARCH_PROVIDERS, type Provider, type SearchProviderId } from "./providers";
import type { CallRecord, LookupRecord, SearchRecord } from "./types";

const PENDING = new Set(["queued", "running", "reconciliation_pending", "pending_provider"]);
const BATCH = 5;

/**
 * Which cache period a time falls in: floor(time / cacheDays). A stored answer stops being fresh after cacheDays, which is
 * at least one period later, so buying again after the cache expires uses a new key and gets new data. Inside one period
 * the key never changes, so a retry replays the same run at no charge.
 */
export const periodOf = (now: Date, cacheDays: number): number => Math.floor(now.getTime() / (cacheDays * 86_400_000));

/** Stable per (input, provider, cache period): no date or time in it, so a retry in the same period never pays twice. */
export const lookupKey = (providerId: string, domain: string, period?: number) => `techstack:${providerId}:${domain}${period === undefined ? "" : `:p${period}`}`;
export const searchKey = (providerId: string, tech: string, period?: number) => `techstack:find:${providerId}:${slugOf(tech)}${period === undefined ? "" : `:p${period}`}`;

/** Hash of what a paid call asks for: endpoint and input, with sorted keys and lowercased text. Guards a short key against a collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => (typeof v === "string" ? v.trim().toLowerCase() : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, norm(x)])) : v);
  return createHash("sha256").update(JSON.stringify([endpointId, norm(input)])).digest("hex");
}

export const cacheId = (providerId: string, domain: string) => `${providerId}|${domain}`;

/** true when a stored answer can be reused: finished and younger than cacheDays. */
export function isFresh(r: { status: string; at: string } | undefined, cacheDays: number, now: Date): boolean {
  return Boolean(r && r.status === "ok" && now.getTime() - new Date(r.at).getTime() < cacheDays * 86_400_000);
}

/** One paid call to make: what to run, under which key, and the list price to reserve for it. */
interface PlannedCall {
  endpointId: string;
  input: Record<string, unknown>;
  key: string;
  priceMicros: number;
}
type Hold = { kind: "go" } | { kind: "stored"; run: LoootRun } | { kind: "refused"; message: string };
interface Ctx {
  looot: LoootRunner;
  ledger?: Ledger;
  now: Date;
}

const ledgered = (ctx: Ctx, c: PlannedCall): Ledger | undefined => (c.priceMicros > 0 ? ctx.ledger : undefined);

/**
 * First half of a paid call: look for a stored answer, then reserve the list price against the period budget. Call it one
 * call at a time so the order of reservations is the order of the work.
 */
async function hold(ctx: Ctx, c: PlannedCall): Promise<Hold> {
  const ledger = ledgered(ctx, c);
  if (!ledger) return { kind: "go" };
  const fp = callFingerprint(c.endpointId, c.input);
  const stored = await ledger.recall(c.key, fp, ctx.now);
  if (stored) return { kind: "stored", run: stored };
  const held = await ledger.reserve(c.key, c.priceMicros, ctx.now, fp);
  return held.ok ? { kind: "go" } : { kind: "refused", message: held.message };
}

/**
 * Second half: make the call, then settle the reservation to the real cost, keep it while the run is still going (it is
 * never counted as $0), or give it back when looot answered with an error. A network error leaves it, since the request
 * may have been accepted. The next replay or the reconcile step settles it.
 */
async function execute(ctx: Ctx, c: PlannedCall): Promise<LoootRun> {
  const ledger = ledgered(ctx, c);
  const fp = callFingerprint(c.endpointId, c.input);
  let run: LoootRun;
  try {
    run = await ctx.looot.runAndWait(c.endpointId, c.input, c.key);
  } catch (e) {
    if (e instanceof LoootError) await ledger?.release(c.key);
    return { runId: "", status: "failed", error: { code: e instanceof LoootError ? (e.code ?? "request_failed") : "request_failed", message: (e as Error).message } };
  }
  if (ledger) {
    if (TERMINAL_STATUSES.has(run.status)) await ledger.settle(c.key, fp, toMicros(run.actualCost), ctx.now, run.status === "completed" ? run : undefined);
    else await ledger.attach(c.key, run.runId);
  }
  return run;
}

export interface LookupInput {
  domains: string[];
  providers: Provider[];
  looot: LoootRunner;
  cache: Record<string, LookupRecord>;
  cacheDays: number;
  capMicros: number;
  now: Date;
  /** Period budget, reservations and stored answers. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
}
export interface LookupOutput {
  records: Record<string, LookupRecord>;
  calls: CallRecord[];
  spentMicros: number;
  /** domain|provider pairs not run because the next call would pass the cap or the period budget. */
  notRun: string[];
  /** Calls not made because the period budget would have been passed. */
  skippedByBudget: number;
  /** The refusal text when the period budget stopped a call, else null. */
  budgetMessage: string | null;
}

/**
 * Calls each provider once per domain, skipping fresh stored answers, and stops before a call that would pass the cap or
 * the period budget. Each call reserves its list price first and settles to the real cost. A run still in progress is
 * stored as pending and keeps its reservation, never recorded as failed at $0.
 */
export async function lookupDomains(input: LookupInput): Promise<LookupOutput> {
  const records = { ...input.cache };
  const calls: CallRecord[] = [];
  const notRun: string[] = [];
  const at = input.now.toISOString();
  const ctx: Ctx = { looot: input.looot, ledger: input.ledger, now: input.now };
  const period = periodOf(input.now, input.cacheDays);
  let spent = 0;
  let skippedByBudget = 0;
  let budgetMessage: string | null = null;
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
    const plan = batch.map((t): PlannedCall => ({ endpointId: t.p.endpointId, input: t.p.input(t.domain), key: lookupKey(t.p.id, t.domain, period), priceMicros: t.p.priceMicros }));
    // Reserve in order, one at a time, so which calls the budget allows does not depend on timing. Then run the held calls together.
    const holds: Hold[] = [];
    for (const c of plan) holds.push(await hold(ctx, c));
    const runs = await Promise.all(plan.map((c, n) => (holds[n].kind === "go" ? execute(ctx, c) : Promise.resolve(null))));
    let refused = false;
    batch.forEach((t, n) => {
      const h = holds[n];
      if (h.kind === "refused") {
        refused = true;
        skippedByBudget += 1;
        budgetMessage = h.message;
        notRun.push(cacheId(t.p.id, t.domain));
        return;
      }
      const run = h.kind === "stored" ? h.run : runs[n]!;
      const cost = h.kind === "stored" ? 0 : toMicros(run.actualCost);
      spent += cost;
      const key = plan[n].key;
      if (h.kind === "go") calls.push({ providerId: t.p.id, key, costMicros: cost, status: run.status, at });
      const base = { domain: t.domain, providerId: t.p.id, costMicros: cost, at };
      if (run.status === "completed") records[cacheId(t.p.id, t.domain)] = { ...base, status: "ok", data: t.p.parse(run.result) };
      else if (PENDING.has(run.status)) records[cacheId(t.p.id, t.domain)] = { ...base, status: "pending" };
      else records[cacheId(t.p.id, t.domain)] = { ...base, status: "failed", error: run.error?.message ?? run.status };
    });
    if (fit < chunk.length || refused) {
      const later = todo.slice(i + fit).map((t) => cacheId(t.p.id, t.domain));
      notRun.push(...later);
      break;
    }
  }
  return { records, calls, spentMicros: spent, notRun, skippedByBudget, budgetMessage };
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
  /** Period budget, reservations and stored answers. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
}

export const searchCacheId = (providerId: string, tech: string) => `${providerId}|${slugOf(tech)}`;

/**
 * "Find companies using X" through each chosen provider. The cap and the period budget are checked before each paid call.
 * PredictLeads is two calls, the technology lookup and the detections list. Each one reserves, runs and settles on its own.
 */
export async function findCompanies(input: SearchInput): Promise<{ records: Record<string, SearchRecord>; calls: CallRecord[]; spentMicros: number; notRun: string[]; skippedByBudget: number; budgetMessage: string | null }> {
  const records = { ...input.cache };
  const calls: CallRecord[] = [];
  const notRun: string[] = [];
  const at = input.now.toISOString();
  const ctx: Ctx = { looot: input.looot, ledger: input.ledger, now: input.now };
  const period = periodOf(input.now, input.cacheDays);
  let spent = 0;
  let skippedByBudget = 0;
  let budgetMessage: string | null = null;
  const refuse = (id: string, message: string) => {
    skippedByBudget += 1;
    budgetMessage = message;
    notRun.push(id);
  };
  for (const id of input.providerIds) {
    const sp = SEARCH_PROVIDERS.find((s) => s.id === id);
    if (!sp) continue;
    const id2 = searchCacheId(id, input.tech);
    if (isFresh(records[id2], input.cacheDays, input.now)) continue;
    if (spent + sp.priceMicros > input.capMicros) {
      notRun.push(id);
      continue;
    }
    const key = searchKey(id, input.tech, period);
    const resolveMicros = (sp as { resolveMicros?: number }).resolveMicros ?? 0;
    let cost = 0;
    let run: LoootRun;
    let finalPaid = true;
    if (id === "builtwith") {
      const c: PlannedCall = { endpointId: sp.endpointId, input: { TECH: input.tech }, key, priceMicros: sp.priceMicros };
      const h = await hold(ctx, c);
      if (h.kind === "refused") {
        refuse(id, h.message);
        continue;
      }
      finalPaid = h.kind === "go";
      run = h.kind === "stored" ? h.run : await execute(ctx, c);
    } else {
      // PredictLeads wants a technology id. Resolve the name first, then list its detections.
      const rc: PlannedCall = { endpointId: "predictleads-technologies-2", input: { technology_id_or_name: input.tech }, key: `${key}:resolve`, priceMicros: resolveMicros };
      const rh = await hold(ctx, rc);
      if (rh.kind === "refused") {
        refuse(id, rh.message);
        continue;
      }
      const resolved = rh.kind === "stored" ? rh.run : await execute(ctx, rc);
      if (rh.kind === "go") cost += toMicros(resolved.actualCost);
      const techId = resolved.status === "completed" ? firstId(resolved.result) : undefined;
      if (techId) {
        const c: PlannedCall = { endpointId: sp.endpointId, input: { technology_id: techId, limit: input.limit ?? 100 }, key, priceMicros: sp.priceMicros - resolveMicros };
        const h = await hold(ctx, c);
        if (h.kind === "refused") {
          // The technology lookup was paid and is stored. Keep its cost, and say the list was not run.
          spent += cost;
          calls.push({ providerId: id, key: rc.key, costMicros: cost, status: resolved.status, at });
          refuse(id, h.message);
          continue;
        }
        finalPaid = h.kind === "go";
        run = h.kind === "stored" ? h.run : await execute(ctx, c);
      } else {
        run = { runId: "", status: PENDING.has(resolved.status) ? resolved.status : "failed", error: { message: "The technology was not found" } };
      }
    }
    if (finalPaid) cost += toMicros(run.actualCost);
    spent += cost;
    if (finalPaid || cost > 0) calls.push({ providerId: id, key, costMicros: cost, status: run.status, at });
    const base = { tech: input.tech, providerId: id, costMicros: cost, at };
    if (run.status === "completed") records[id2] = { ...base, status: "ok", hits: parseSearchHits(id, run.result).map((h) => ({ ...h, providers: [id] })) };
    else if (PENDING.has(run.status)) records[id2] = { ...base, status: "pending", hits: [] };
    else records[id2] = { ...base, status: "failed", error: run.error?.message ?? run.status, hits: [] };
  }
  return { records, calls, spentMicros: spent, notRun, skippedByBudget, budgetMessage };
}

function firstId(body: unknown): string | undefined {
  const b = body as { data?: unknown } | null;
  const d = Array.isArray(b?.data) ? (b!.data as { id?: unknown }[])[0] : (b?.data as { id?: unknown } | undefined);
  const id = d?.id ?? (body as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

export { providerById };
