import "server-only";
import { resolve } from "node:path";
import { buildDemoState, DemoRunner } from "@/demo/seed";
import { ConfigSchema, DEFAULT_CONFIG, type TechstackConfig } from "./config";
import { parseDomains } from "./domain";
import { hasLoootToken, loootFromEnv, type LoootRunner } from "./looot";
import type { ShellSpend, ShellSpendRow } from "@/components/AppShell";
import { Budget, type BudgetStatus, type PeriodStatus } from "./budget";
import { toMicros, usd } from "./money";
import { PROVIDERS } from "./providers";
import type { Quote } from "./quote";
import { chooseProviders, chooseSearchProviders, quoteFind, quoteLookup, resultsFor, runFind, runLookup, searchHits } from "./service";
import { commitState, knownDomains, loadConfig, loadState, snapshotState, type State } from "./state";
import type { DomainResult } from "./types";
import { allow, retryAfter } from "./auth/limits";
import { cleanKey, fingerprint, lookupReplay, remember } from "./idempotency";

export const isDemo = (): boolean => process.env.NEXT_PUBLIC_DEMO === "1";

const statePath = () => resolve(/* turbopackIgnore: true */ process.env.TECHSTACK_DATA ?? "data/techstack.json");
const configPath = () => resolve(/* turbopackIgnore: true */ process.env.TECHSTACK_CONFIG ?? "techstack.config.json");

const g = globalThis as unknown as { __techDemo?: Promise<State> };

/** In demo mode the state lives in memory and resets on restart. Otherwise it is a JSON file. */
async function open(): Promise<{ state: State; config: TechstackConfig; commit: (after?: (fresh: State) => void) => Promise<void>; looot: LoootRunner | null }> {
  if (isDemo()) {
    g.__techDemo ??= buildDemoState();
    return { state: await g.__techDemo, config: DEFAULT_CONFIG, commit: async (after) => after?.(await g.__techDemo!), looot: new DemoRunner() };
  }
  const state = loadState(statePath());
  const snap = snapshotState(state);
  return { state, config: loadConfig(configPath()), commit: async (after) => void (await commitState(statePath(), state, snap, after)), looot: hasLoootToken() ? loootFromEnv() : null };
}

/** The period budget file, next to the state file. */
export function getBudget(): Budget {
  return new Budget();
}

/** Used, reserved and remaining for today and this month. */
export async function budgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  return getBudget().status(now);
}

/** Owner only (the route checks the session and the CSRF token). Saves the daily and monthly budget in dollars. */
export async function setBudget(input: { dailyUsd: unknown; monthlyUsd: unknown }): Promise<BudgetStatus> {
  if (isDemo()) throw new Error("Demo mode has no budget to change.");
  const b = getBudget();
  await b.setLimits({ dailyMicros: toMicros(Number(input.dailyUsd)), monthlyMicros: toMicros(Number(input.monthlyUsd)) });
  return b.status();
}

/** Free. Used, reserved and remaining against the daily and monthly budget, for the sidebar. */
export async function getSpend(): Promise<ShellSpend> {
  const [b, { config }] = await Promise.all([budgetStatus(), open()]);
  const row = (label: string, p: PeriodStatus): ShellSpendRow => ({ label, used: usd(p.usedMicros), reserved: usd(p.reservedMicros), remaining: usd(p.remainingMicros), cap: usd(p.limitMicros), ratio: p.limitMicros > 0 ? (p.usedMicros + p.reservedMicros) / p.limitMicros : 0 });
  return { title: "Spend budget", rows: [row("Today", b.day), row("Month", b.month)], note: isDemo() ? "Sample data, nothing charged." : `Cap per run: ${usd(toMicros(config.spendCapUsd))}.` };
}

export interface CostRow {
  providerId: string;
  answers: number;
  failed: number;
  pending: number;
  costMicros: number;
}

/** Free. What the stored answers cost, by provider. A cost of $0 means the answer was free or came from a replay. */
export async function getCostRows(): Promise<{ rows: CostRow[]; totalMicros: number }> {
  const { state } = await open();
  const by = new Map<string, CostRow>();
  for (const r of [...Object.values(state.lookups), ...Object.values(state.searches)]) {
    const row = by.get(r.providerId) ?? { providerId: r.providerId, answers: 0, failed: 0, pending: 0, costMicros: 0 };
    if (r.status === "ok") row.answers += 1;
    else if (r.status === "pending") row.pending += 1;
    else row.failed += 1;
    row.costMicros += r.costMicros;
    by.set(r.providerId, row);
  }
  const rows = [...by.values()].sort((a, b) => b.costMicros - a.costMicros);
  return { rows, totalMicros: rows.reduce((n, r) => n + r.costMicros, 0) };
}

export interface Common {
  demo: boolean;
  hasToken: boolean;
  config: TechstackConfig;
  capMicros: number;
}

export async function getCommon(): Promise<Common> {
  const { config, looot } = await open();
  return { demo: isDemo(), hasToken: looot !== null, config, capMicros: toMicros(config.spendCapUsd) };
}

/** Free. Every stored domain with its merged result. */
export async function getResults(): Promise<{ common: Common; results: DomainResult[] }> {
  const { state, config, looot } = await open();
  return { common: { demo: isDemo(), hasToken: looot !== null, config, capMicros: toMicros(config.spendCapUsd) }, results: resultsFor(state, knownDomains(state)) };
}

export async function getFind(tech: string | undefined) {
  const { state } = await open();
  const techs = [...new Set(Object.values(state.searches).map((s) => s.tech))];
  return { techs, tech: tech ?? techs[0], hits: tech ?? techs[0] ? searchHits(state, tech ?? techs[0]!) : [], records: Object.values(state.searches).filter((s) => s.tech.toLowerCase() === (tech ?? techs[0] ?? "").toLowerCase()) };
}

/** Free. Quotes a lookup from pasted text. */
export async function quoteText(text: string, providerIds: string[] | undefined): Promise<{ quote: Quote; invalid: string[] }> {
  const { state, config } = await open();
  const { domains, invalid } = parseDomains(text);
  return { quote: quoteLookup(state, config, domains, chooseProviders(providerIds, config), toMicros(config.spendCapUsd), new Date()), invalid };
}

export async function quoteFindText(tech: string, ids: string[] | undefined): Promise<Quote> {
  const { state, config } = await open();
  return quoteFind(state, config, tech, chooseSearchProviders(ids), toMicros(config.spendCapUsd), new Date());
}

/** Paid actions allowed per session in a window. */
export const SPEND_REQUESTS_PER_WINDOW = 10;
export const SPEND_WINDOW_MS = 10 * 60_000;

/** What the browser sends with a paid request. Money comes from the server, never from here. */
export interface PaidRequest {
  /** The total the caller saw in the quote, in micros. The run is bounded by it and by the server cap. */
  quoteMicros?: unknown;
  /** Optional caller key. The same key with the same request replays the stored answer. */
  idempotencyKey?: unknown;
  /** The admin session id, for the per-session rate limit. */
  sid?: string;
}

export class PaidRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * The one path for a paid request: replay, quote, per-run cap, rate limit, period budget, run, remember.
 * 1. An identical request (same domains or technology, same providers) or the same caller key replays the stored answer and calls nothing.
 * 2. The server prices the request itself. The caller must send the total it saw, and the run is bounded by that total and by the config cap.
 * 3. A session may start `SPEND_REQUESTS_PER_WINDOW` paid requests per window.
 * 4. Runs that ended since last time are settled, then the request is refused if it would not fit what is left of the daily or monthly budget.
 * 5. Each call reserves its list price in the budget file before it is made, so concurrent requests cannot both pass, and settles to the real cost.
 * The cap and the budget come from the server only. Nothing in the request can raise them.
 */
async function paid<T extends { spentMicros: number; calls: number; skippedByBudget: number; budgetMessage: string | null }>(kind: "lookup" | "find", subject: string[] | string, providerIds: string[], req: PaidRequest, price: (state: State, config: TechstackConfig, now: Date) => Quote, run: (cap: number, d: Awaited<ReturnType<typeof open>> & { looot: LoootRunner }, now: Date, ledger?: Budget) => Promise<T>): Promise<T & { replayed?: boolean; quote: Quote }> {
  const d = await open();
  if (!d.looot) throw new PaidRequestError("LOOOT_TOKEN is not set on the server.", 400);
  const now = new Date();
  const fp = fingerprint(kind, subject, providerIds);
  const replay = lookupReplay(d.state, kind, fp, cleanKey(req.idempotencyKey), now);
  if (replay.kind === "conflict") throw new PaidRequestError("That idempotency key was used for a different request.", 409);
  if (replay.kind === "hit") return { ...(replay.response as T & { quote: Quote }), replayed: true };
  const flightKey = replay.keys.at(-1)!;
  const pending = inflight.get(flightKey);
  if (pending) return { ...((await pending) as T & { quote: Quote }), replayed: true };
  if (typeof req.quoteMicros !== "number" || !Number.isFinite(req.quoteMicros) || req.quoteMicros < 0) throw new PaidRequestError("Get a quote first, then send its total as quoteMicros.", 400);
  const quote = price(d.state, d.config, now);
  if (quote.totalMicros > req.quoteMicros) throw new PaidRequestError(`The price is now ${usd(quote.totalMicros)}, above the ${usd(req.quoteMicros)} you were quoted. Get a new quote.`, 409);
  const limitKey = `spend:${req.sid ?? "demo"}`;
  if (!allow(limitKey, SPEND_REQUESTS_PER_WINDOW, SPEND_WINDOW_MS)) throw new PaidRequestError(`Too many paid requests from this session. Try again in ${retryAfter(limitKey)} seconds.`, 429);
  const cap = Math.min(toMicros(d.config.spendCapUsd), req.quoteMicros);
  // The job is registered in `inflight` before its first await, so an identical request arriving meanwhile waits for it.
  const job = (async () => {
    const budget = isDemo() ? undefined : getBudget();
    if (budget) {
      const looot = d.looot!;
      if (looot.getRun) await budget.reconcile({ getRun: (id) => looot.getRun!(id) });
      const room = await budget.status(now);
      const needed = Math.min(quote.totalMicros, cap);
      if (needed > room.remainingMicros) throw new PaidRequestError(`The quote (${usd(needed)}) is above what is left of the budget (${usd(room.remainingMicros)}: ${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month). Nothing was called. Raise the budget on the Costs page, or wait for the period to roll over.`, 409);
    }
    const out = await run(cap, { ...d, looot: d.looot! }, now, budget);
    // Nothing ran and the budget said no: answer with the refusal. No reply is stored, so a retry after a raise goes through.
    if (out.skippedByBudget > 0 && out.calls === 0 && out.spentMicros === 0) {
      await d.commit();
      throw new PaidRequestError(out.budgetMessage ?? "The budget is reached.", 409);
    }
    const response = { ...out, quote };
    // Only an answer that spent money and was not cut short by the budget is stored. Otherwise asking again finishes the work.
    await d.commit((fresh) => {
      if (out.spentMicros > 0 && out.skippedByBudget === 0) remember(fresh, replay.keys, fp, response, now);
    });
    return response;
  })();
  inflight.set(flightKey, job);
  try {
    return (await job) as T & { quote: Quote };
  } finally {
    inflight.delete(flightKey);
  }
}

/** Paid. Runs the lookup, stopping before a call that would pass the cap. */
export async function lookupText(text: string, providerIds: string[] | undefined, req: PaidRequest = {}) {
  const { domains } = parseDomains(text);
  if (domains.length === 0) throw new PaidRequestError("No valid domains found.", 400);
  const config = (await open()).config;
  const providers = chooseProviders(providerIds, config);
  return paid(
    "lookup",
    domains,
    providers.map((p) => p.id),
    req,
    (state, cfg, now) => quoteLookup(state, cfg, domains, providers, toMicros(cfg.spendCapUsd), now),
    async (cap, d, now, ledger) => {
      const out = await runLookup(d.state, d.config, d.looot, domains, providers, cap, now, ledger);
      return { domains, spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.length, skippedByBudget: out.skippedByBudget, budgetMessage: out.budgetMessage };
    },
  );
}

/** Paid. Finds companies that use a technology. Same quote, cap, replay and rate limit as `lookupText`. */
export async function findTech(tech: string, ids: string[] | undefined, req: PaidRequest = {}) {
  const searchIds = chooseSearchProviders(ids);
  return paid(
    "find",
    tech,
    searchIds,
    req,
    (state, cfg, now) => quoteFind(state, cfg, tech, searchIds, toMicros(cfg.spendCapUsd), now),
    async (cap, d, now, ledger) => {
      const out = await runFind(d.state, d.config, d.looot, tech, searchIds, cap, now, ledger);
      return { spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.length, skippedByBudget: out.skippedByBudget, budgetMessage: out.budgetMessage };
    },
  );
}

export { ConfigSchema };

/** Free. The stored provider answers for one domain, in provider order. */
export async function getRecords(domain: string) {
  const { state } = await open();
  const order = (id: string) => PROVIDER_ORDER.indexOf(id);
  return Object.values(state.lookups).filter((r) => r.domain === domain).sort((a, b) => order(a.providerId) - order(b.providerId));
}
const PROVIDER_ORDER = PROVIDERS.map((p) => p.id);
