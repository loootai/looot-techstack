import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Budget, defaultLimits } from "@/lib/budget";
import { parseDomains } from "@/lib/domain";
import { LoootError, loootFromEnv, type LoootRunner } from "@/lib/looot";
import { toMicros, usd } from "@/lib/money";
import { PRICES_AS_OF } from "@/lib/providers";
import { chooseProviders, chooseSearchProviders, quoteFind, quoteLookup, resultsFor, runFind, runLookup, searchHits } from "@/lib/service";
import { commitState, loadConfig, loadState, snapshotState } from "@/lib/state";
import { renderCsv, renderMarkdown, renderQuote } from "./render";

export const HELP = `Usage: npm run techstack -- (--domains <file> | --domain <host>) [options]

  --domains <file>        Domains, one per line, comma separated, or a CSV with a domain column.
  --domain <host>         One domain, for a quick check.
  --providers <ids>       Comma list: builtwith-free, tomba, predictleads, builtwith, theirstack. Default: the config's list.
  --find <technology>     Also find companies using this technology (BuiltWith Lists and PredictLeads).
  --find-providers <ids>  Comma list: builtwith, predictleads. Default: both.
  --config <file>         techstack.config.json. Default: techstack.config.json, else built-in.
  --out <dir>             Where techstack.json, techstack.csv and techstack.md go. Default: out
  --state <file>          Answers already bought, so repeats are free. Default: state/techstack.json
  --cap <usd>             Spend cap for this run. Default: the config's spendCapUsd
  --partial               Run until the daily or monthly budget stops it, instead of refusing a run that does not fit.
  --dry-run               Print the list-price cost and make no call. Writes nothing.

The daily and monthly budget is in budget.json next to the state file ($10 and $50 until you edit it in the web app or set
TECHSTACK_DAILY_USD and TECHSTACK_MONTHLY_USD). Needs LOOOT_TOKEN in the environment, except with --dry-run.
Exit codes: 0 done, 1 run failed, 2 usage error.`;

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (s: string) => void;
  err: (s: string) => void;
  now?: Date;
  /** Tests pass a mock. Real runs build one from LOOOT_TOKEN. */
  looot?: LoootRunner;
}

const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);

/** Runs the headless command. Returns the exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const now = deps.now ?? new Date();
  let a;
  try {
    a = parseArgs({ args: argv, options: { domains: { type: "string" }, domain: { type: "string" }, providers: { type: "string" }, find: { type: "string" }, "find-providers": { type: "string" }, config: { type: "string" }, out: { type: "string", default: "out" }, state: { type: "string", default: "state/techstack.json" }, cap: { type: "string" }, "dry-run": { type: "boolean", default: false }, partial: { type: "boolean", default: false }, help: { type: "boolean", default: false } } }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (a.help) return deps.out(HELP), 0;
  if (!a.domains && !a.domain && !a.find) return deps.err(`Give --domains, --domain or --find.\n\n${HELP}`), 2;
  if (a.domains && !existsSync(a.domains)) return deps.err(`No file at ${a.domains}`), 2;

  let config;
  try {
    config = loadConfig(resolve(a.config ?? "techstack.config.json"));
  } catch (e) {
    return deps.err(`The config is not valid: ${(e as Error).message}`), 2;
  }
  const capUsd = a.cap === undefined ? config.spendCapUsd : Number(a.cap);
  if (!Number.isFinite(capUsd) || capUsd < 0) return deps.err("--cap must be a number of dollars."), 2;
  const cap = toMicros(capUsd);

  const parsed = parseDomains([a.domain ?? "", a.domains ? readFileSync(a.domains, "utf8") : ""].join("\n"));
  if (parsed.invalid.length > 0) deps.out(`Skipped ${parsed.invalid.length} values that are not domains: ${parsed.invalid.slice(0, 5).join(", ")}`);
  const providers = chooseProviders(list(a.providers), config);
  const findIds = chooseSearchProviders(list(a["find-providers"]));
  if (providers.length === 0 && parsed.domains.length > 0) return deps.err("No valid provider id in --providers."), 2;

  const statePath = resolve(a.state as string);
  const state = loadState(statePath);
  const snap = snapshotState(state);
  const priceNote = `List prices dated ${PRICES_AS_OF}. The real charge is read from each run.`;
  if (parsed.domains.length > 0) deps.out(renderQuote(quoteLookup(state, config, parsed.domains, providers, cap, now), `${parsed.domains.length} domains x ${providers.length} providers`, priceNote));
  if (a.find) deps.out(renderQuote(quoteFind(state, config, a.find, findIds, cap, now), `Find companies using ${a.find}`, priceNote));
  if (a["dry-run"]) return deps.out("Dry run: no looot call was made and nothing was written."), 0;
  const quoted = (parsed.domains.length > 0 ? quoteLookup(state, config, parsed.domains, providers, cap, now).totalMicros : 0) + (a.find ? quoteFind(state, config, a.find, findIds, cap, now).totalMicros : 0);

  let looot = deps.looot;
  if (!looot) {
    try {
      looot = loootFromEnv(deps.env);
    } catch (e) {
      if (e instanceof LoootError) return deps.err("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run."), 2;
      throw e;
    }
  }

  // Check order: quote, per-run cap, period budget, then the calls. Runs that ended since last time settle first.
  const budget = new Budget(join(dirname(statePath), "budget.json"), defaultLimits(deps.env));
  if (looot.getRun) await budget.reconcile({ getRun: (id) => looot.getRun!(id) }, now);
  const room = await budget.status(now);
  if (quoted > room.remainingMicros && !a.partial) {
    return deps.err(`The quote (${usd(quoted)}) is above what is left of the budget (${usd(room.remainingMicros)}: ${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month). Nothing was called. Pass --partial to run until the budget stops it, or set TECHSTACK_DAILY_USD and TECHSTACK_MONTHLY_USD. To share the web app's budget, point --state at its data/techstack.json.`), 2;
  }

  let spent = 0;
  let notRun = 0;
  let budgetMessage: string | null = null;
  let pending = 0;
  if (parsed.domains.length > 0) {
    const r = await runLookup(state, config, looot, parsed.domains, providers, cap, now, budget);
    spent += r.spentMicros;
    notRun += r.notRun.length;
    budgetMessage = r.budgetMessage ?? budgetMessage;
  }
  if (a.find) {
    const r = await runFind(state, config, looot, a.find, findIds, Math.max(0, cap - spent), now, budget);
    spent += r.spentMicros;
    notRun += r.notRun.length;
    budgetMessage = r.budgetMessage ?? budgetMessage;
  }
  await commitState(statePath, state, snap);

  const results = resultsFor(state, parsed.domains);
  pending = results.reduce((n, r) => n + r.pendingProviders.length, 0) + Object.values(state.searches).filter((s) => s.status === "pending").length;
  const hits = a.find ? searchHits(state, a.find) : undefined;
  const outDir = resolve(a.out as string);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "techstack.json"), `${JSON.stringify({ generatedAt: now.toISOString(), spentThisRunMicros: spent, domains: results, ...(hits ? { find: { tech: a.find, hits } } : {}) }, null, 2)}\n`);
  writeFileSync(join(outDir, "techstack.csv"), renderCsv(results));
  writeFileSync(join(outDir, "techstack.md"), renderMarkdown(results, `Technology lookup, ${now.toISOString().slice(0, 10)}`, hits ? { tech: a.find!, hits } : undefined));

  deps.out(`Spent ${usd(spent)} this run. ${results.length} domains${hits ? `, ${hits.length} companies using ${a.find}` : ""}. Files in ${outDir}`);
  if (budgetMessage) deps.out(`Stopped by the budget: ${budgetMessage}`);
  else if (notRun > 0) deps.out(`Stopped at the ${usd(cap)} cap: ${notRun} calls were not run. Run again with a higher --cap.`);
  if (pending > 0) deps.out(`${pending} calls are pending (still running at the provider). Run the same command again to collect them. Pending runs are not charged twice.`);
  const failed = results.reduce((n, r) => n + r.failedProviders.length, 0);
  if (failed > 0 && failed === results.length * providers.length) return deps.err("Every call failed. See the error in the state file."), 1;
  return 0;
}
