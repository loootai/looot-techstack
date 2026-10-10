import "server-only";
import { resolve } from "node:path";
import { buildDemoState, DemoRunner } from "@/demo/seed";
import { ConfigSchema, DEFAULT_CONFIG, type TechstackConfig } from "./config";
import { parseDomains } from "./domain";
import { hasLoootToken, loootFromEnv, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { PROVIDERS } from "./providers";
import type { Quote } from "./quote";
import { chooseProviders, chooseSearchProviders, quoteFind, quoteLookup, resultsFor, runFind, runLookup, searchHits } from "./service";
import { knownDomains, loadConfig, loadState, saveState, type State } from "./state";
import type { DomainResult } from "./types";

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

/** Paid. Runs the lookup, stopping before a call that would pass the cap. */
export async function lookupText(text: string, providerIds: string[] | undefined) {
  const { state, config, looot, save } = await open();
  if (!looot) throw new Error("LOOOT_TOKEN is not set on the server.");
  const { domains } = parseDomains(text);
  if (domains.length === 0) throw new Error("No valid domains found.");
  const out = await runLookup(state, config, looot, domains, chooseProviders(providerIds, config), toMicros(config.spendCapUsd), new Date());
  save();
  return { domains, spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.length };
}

export async function findTech(tech: string, ids: string[] | undefined) {
  const { state, config, looot, save } = await open();
  if (!looot) throw new Error("LOOOT_TOKEN is not set on the server.");
  const out = await runFind(state, config, looot, tech, chooseSearchProviders(ids), toMicros(config.spendCapUsd), new Date());
  save();
  return { spentMicros: out.spentMicros, calls: out.calls.length, notRun: out.notRun.length };
}

export { ConfigSchema };

/** Free. The stored provider answers for one domain, in provider order. */
export async function getRecords(domain: string) {
  const { state } = await open();
  const order = (id: string) => PROVIDER_ORDER.indexOf(id);
  return Object.values(state.lookups).filter((r) => r.domain === domain).sort((a, b) => order(a.providerId) - order(b.providerId));
}
const PROVIDER_ORDER = PROVIDERS.map((p) => p.id);
