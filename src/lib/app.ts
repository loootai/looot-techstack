import "server-only";
import { resolve } from "node:path";
import { buildDemoState, DemoRunner } from "@/demo/seed";
import { ConfigSchema, DEFAULT_CONFIG, type TechstackConfig } from "./config";
import { parseDomains } from "./domain";
import { hasLoootToken, loootFromEnv, type LoootRunner } from "./looot";
import type { ShellSpend } from "@/components/AppShell";
import { toMicros, usd } from "./money";
import { PROVIDERS } from "./providers";
import type { Quote } from "./quote";
import { chooseProviders, chooseSearchProviders, quoteFind, quoteLookup, resultsFor, runFind, runLookup, searchHits } from "./service";
import { knownDomains, loadConfig, loadState, saveState, type State } from "./state";
import type { DomainResult } from "./types";
import { allow, retryAfter } from "./auth/limits";
import { cleanKey, fingerprint, lookupReplay, remember } from "./idempotency";

export const isDemo = (): boolean => process.env.NEXT_PUBLIC_DEMO === "1";

const statePath = () => resolve(/* turbopackIgnore: true */ process.env.TECHSTACK_DATA ?? "data/techstack.json");
const configPath = () => resolve(/* turbopackIgnore: true */ process.env.TECHSTACK_CONFIG ?? "techstack.config.json");

const g = globalThis as unknown as { __techDemo?: Promise<State> };

/** In demo mode the state lives in memory and resets on restart. Otherwise it is a JSON file. */
async function open(): Promise<{ state: State; config: TechstackConfig; save: () => void; looot: LoootRunner | null }> {
  if (isDemo()) {
    g.__techDemo ??= buildDemoState();
    return { state: await g.__techDemo, config: DEFAULT_CONFIG, save: () => {}, looot: new DemoRunner() };
  }
  const state = loadState(statePath());
  return { state, config: loadConfig(configPath()), save: () => saveState(statePath(), state), looot: hasLoootToken() ? loootFromEnv() : null };
}

/** Free. What the stored answers cost in total, shown in the sidebar. The cap is per run, so it is a note and not a limit on this number. */
export async function getSpend(): Promise<ShellSpend> {
  const { state, config } = await open();
  const micros = [...Object.values(state.lookups), ...Object.values(state.searches)].reduce((n, r) => n + r.costMicros, 0);
  return { title: "Spent, stored answers", spent: usd(micros), cap: null, ratio: 0, note: `Cap per run: ${usd(toMicros(config.spendCapUsd))}.` };
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
 * The one path for a paid request: quote, server cap, replay, rate limit, run, remember.
 * 1. The server prices the request itself. The caller must send the total it saw, and the run is bounded by that total and by the config cap.
 * 2. An identical request (same domains or technology, same providers) or the same caller key replays the stored answer and calls nothing.
 * 3. A session may start `SPEND_REQUESTS_PER_WINDOW` paid requests per window.
 */
async function paid<T extends { spentMicros: number }>(kind: "lookup" | "find", subject: string[] | string, providerIds: string[], req: PaidRequest, price: (state: State, config: TechstackConfig, now: Date) => Quote, run: (cap: number, d: Awaited<ReturnType<typeof open>> & { looot: LoootRunner }, now: Date) => Promise<T>): Promise<T & { replayed?: boolean; quote: Quote }> {
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
  const job = (async () => {
    const out = await run(cap, { ...d, looot: d.looot! }, now);
    const response = { ...out, quote };
    // Only an answer that spent money is stored. A request that bought nothing may be retried.
    if (out.spentMicros > 0) remember(d.state, replay.keys, fp, response, now);
    d.save();
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
    async (cap, d, now) => {
      const out = await runLookup(d.state, d.config, d.looot, domains, providers, cap, now);
      return { domains, spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.length };
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
    async (cap, d, now) => {
      const out = await runFind(d.state, d.config, d.looot, tech, searchIds, cap, now);
      return { spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.length };
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
