import { DEFAULT_CONFIG } from "@/lib/config";
import { findCompanies, lookupDomains } from "@/lib/engine";
import { PROVIDERS } from "@/lib/providers";
import { emptyState, type State } from "@/lib/state";
import { DEMO_DOMAINS, DemoRunner } from "./fixtureRunner";

/** Builds the demo state by running the real engine over made-up domains and a fixture runner. All providers except TheirStack run, so the agreement view has three or four lists to compare. */
export async function buildDemoState(now: Date = new Date()): Promise<State> {
  const state = emptyState();
  const runner = new DemoRunner();
  const providers = PROVIDERS.filter((p) => p.id !== "theirstack");
  const out = await lookupDomains({ domains: DEMO_DOMAINS, providers, looot: runner, cache: {}, cacheDays: DEFAULT_CONFIG.cacheDays, capMicros: 10_000_000, now });
  state.lookups = out.records;
  state.calls = out.calls;
  const found = await findCompanies({ tech: "HubSpot", providerIds: ["builtwith", "predictleads"], looot: runner, cache: {}, cacheDays: 30, capMicros: 10_000_000, now });
  state.searches = found.records;
  state.calls.push(...found.calls);
  return state;
}

export { DemoRunner };
