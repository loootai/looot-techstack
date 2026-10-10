<p align="center"><img src="assets/hero.png" alt="looot-techstack" width="100%"></p>

# looot-techstack

[![License](https://img.shields.io/github/license/loootai/looot-techstack)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-techstack)](https://github.com/loootai/looot-techstack/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to [BuiltWith](https://builtwith.com/plans) and [Wappalyzer](https://www.wappalyzer.com/pricing/) lookups: what technology a company's website uses, and which companies use a technology. BuiltWith starts at $295 a month and Wappalyzer's paid plans at $250 a month, with a free tier of 50 lookups a month (public pricing pages, read 2026-10-10). This repo runs on one looot key and you pay list price per domain, from $0 up to a few cents.

It asks several technology providers about each domain and shows their answers side by side: technologies by category, which providers named each one, how much the providers agree, and first and last seen dates where a provider gives them.

![Lookup, light](docs/screenshots/lookup-light.png)
![Bulk table, dark](docs/screenshots/bulk-dark.png)

## How it differs from the originals

BuiltWith and Wappalyzer run their own crawlers. This repo does not detect anything itself. It queries the providers behind looot's `company.technographics` job and compares them. That is slower to trust and cheaper to run, and the side-by-side view shows you where providers disagree instead of hiding it. Wappalyzer's browser extension and its own fingerprint database are not replicated.

## What you need

- Node 22.12 or newer. The repo has no `engines` field or `.nvmrc`. Next.js 16 needs 20.9 or newer and the test runner (Vitest 5) needs 22.12 or newer. I ran it on Node 24.
- npm.
- A looot account and token, only for real lookups. Sign up at https://looot.ai/auth/sign-up. To get a token, run `looot login` (`npm i -g looot`), which opens a browser approval. Or in the looot web app go to Settings, "Agent tokens", and create one (https://docs.looot.ai/get-started/sign-in). With no browser or in CI, create the token in Settings, Agent tokens, then `export LOOOT_TOKEN=...`. The token needs the scopes runs.execute, catalog.read, runs.read and usage.read.
- A funded balance. Minimum top-up is $5. Signing up adds no credit (https://docs.looot.ai/money).

No other account is needed. The app does not use Supabase, an LLM key or any other service.

## Try it in one minute

No account and no token.

```bash
git clone https://github.com/loootai/looot-techstack && cd looot-techstack
npm install --ignore-scripts
npm run demo
```

Open http://localhost:3530. It shows made-up companies with fixture answers. Stop it with Ctrl-C. To check the CLI without a token, see the dry run below.

## Run it with your own data

The web app (`npm run dev`, or `npm run build && npm start`) reads `.env.local`. The CLI does not read any env file, so export the variables in your shell.

```bash
cp .env.example .env.local     # web app only
export LOOOT_TOKEN=...         # CLI
```

| Variable | Required | What it does | Where to get it |
|---|---|---|---|
| `LOOOT_TOKEN` | Required for real lookups, not for `--dry-run` or the demo | Bearer token for the looot API | Settings, Agent tokens in the looot app, or `looot login` |
| `LOOOT_API_URL` | Optional | looot API base URL. Default `https://api.looot.ai` | Leave unset |
| `TECHSTACK_DATA` | Optional | State file the web app uses for stored answers. Default `data/techstack.json` | A path you choose |
| `TECHSTACK_CONFIG` | Optional | Config file the web app reads. Default `techstack.config.json` | A path you choose |
| `NEXT_PUBLIC_DEMO` | Optional | `1` turns on demo mode with fixture answers. `npm run demo` sets it | Do not set it for real use |

`techstack.config.json` sets the default `providers`, `spendCapUsd` (default 1) and `cacheDays` (default 30).

Input is one domain per line, comma separated, or a CSV with a `domain` column. URLs are reduced to the host. `examples/domains.csv` is a three-line example. Dry run first. It needs no token and calls nothing:

```bash
npm run techstack -- --domains examples/domains.csv --dry-run
```

Real output from that command:

```
3 domains x 3 providers: 0 answers already stored (free), the rest run.
  BuiltWith Free: 3 x $0.0000 = $0.00  [company.technographics, builtwith-free1-api-json]
  Tomba: 3 x $0.0089 = $0.03  [company.technographics, tomba-technology]
  PredictLeads: 3 x $0.0100 = $0.03  [company.technographics, predictleads-companies-technology-detections]
Total: $0.06. Spend cap: $1.00.
List prices dated 2026-10-10. The real charge is read from each run.
Dry run: no looot call was made and nothing was written.
```

Then the real run:

```bash
LOOOT_TOKEN=... npm run techstack -- --domains examples/domains.csv --cap 0.50
LOOOT_TOKEN=... npm run techstack -- --domain stripe.com --providers builtwith-free,tomba,predictleads,builtwith
npm run techstack -- --find HubSpot --dry-run     # companies using a technology
```

Results go to `out/techstack.json`, `out/techstack.csv` (one row per domain and technology) and `out/techstack.md`. Answers are stored in `state/techstack.json` for 30 days, so asking again is free. Change the folders with `--out` and `--state`. Run `npm run techstack -- --help` for every flag. The web app has a domain lookup, a bulk table with a technology filter and CSV export, and a "find companies" page. Its stored answers live in `data/techstack.json`, a different file from the CLI's.

## Spending

- The quote shows before any paid action, line by line. It is exact. Each domain and provider pair is one call.
- The cap is `--cap <usd>` on the CLI and `spendCapUsd` in `techstack.config.json`. The default is $1. A run stops before a call that would pass it and prints how many calls were not run.
- Typical run at list price. 100 domains on the default three providers cost 100 x $0.0189 = $1.89. Adding BuiltWith makes it $6.84. The same 100 domains cost $0 to look up again for 30 days.
- Each call sends a stable idempotency key per (domain, provider), for example `techstack:tomba:stripe.com`. A retry never pays twice.
- A run still in progress when waiting stops is stored as pending. The next run collects it. It is never treated as failed at $0.
- Failed calls are not charged by looot. The tool reads the real charge from each run.

## Providers and prices

All five are the looot job `company.technographics`. Prices are list prices read from the public catalog on 2026-10-10.

| Provider | Endpoint | Price per domain | Gives | Default |
|---|---|---|---|---|
| BuiltWith Free | `builtwith-free1-api-json` | $0 | Category counts, first and last seen. No technology names. | on |
| Tomba | `tomba-technology` | $0.0089 | Technologies with categories | on |
| PredictLeads | `predictleads-companies-technology-detections` | $0.0100 | Technologies with first and last seen | on |
| BuiltWith | `builtwith-api-json` | $0.0495 | Full profile, live and dead, first and last detected | off |
| TheirStack | `theirstack-companies-technologies` | $0.0981 | From job posts, with a confidence level and dates | off |

Find companies using a technology:

| Provider | Endpoint | Price per search |
|---|---|---|
| BuiltWith Lists | `builtwith-lists12-api-json` | $0.0495 |
| PredictLeads | `predictleads-technologies-2` then `predictleads-discover-technologies-technology-detections` | $0.03 + $0.01 |

Typical run at list price: 100 domains on the default three providers cost 100 x $0.0189 = $1.89. Adding BuiltWith makes it $6.84. The same 100 domains cost $0 to look up again for 30 days.

## Agreement between providers

For each technology the app shows which providers listed it and "2 of 3": how many of the providers that returned a technology list named it. A provider that failed, is pending or only returns category counts does not count in the base. Technology names are matched by a normalised key (case, punctuation and a `.js` suffix are ignored, and a short alias list covers cases such as AWS and Amazon Web Services). Two providers that spell a product differently beyond that will show as two technologies. Add the spelling to `ALIASES` in `src/lib/parse.ts`. The overlap panel shows shared technologies and a percentage for each pair of providers.

## Deploy

There is no `vercel.json` and no GitHub workflow in this repo. The app keeps its stored answers in a JSON file on disk (`data/techstack.json`, or the path in `TECHSTACK_DATA`), so it needs a host with a writable, persistent disk. I have not deployed it. On such a host run `npm ci --ignore-scripts && npm run build && npm start`, and set `LOOOT_TOKEN` in the host's environment. There is no sign-in, so put it behind your own access control.

## Troubleshooting

| What you see | What it means and what to do |
|---|---|
| `LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run.` | The CLI found no token. The quote prints first, then this line, exit code 2. Export `LOOOT_TOKEN` or add `--dry-run`. |
| `LOOOT_TOKEN is not set on the server, so the run is disabled.` | Web app with no token. Set it in `.env.local` and restart. |
| `looot returned HTTP 401` (or the API's own error message) in a provider's error column | The token is wrong, expired or lacks a scope. Create a new one with runs.execute, catalog.read, runs.read and usage.read. |
| `looot returned HTTP 402` (or the API's own message) | The balance is too low. The code does not check this itself. It stores the API's message for that call. Top up (minimum $5) and run again. |
| A provider shows `blocked` or `stopped` in the status column | looot did not run the call. The tool stores the status when the run has no error message, and charges nothing. Open the run in your looot app for the reason. |
| `Every call failed. See the error in the state file.` | Exit code 1. Open `state/techstack.json` and read the `error` of each call. |
| `Stopped at the $1.00 cap: N calls were not run. Run again with a higher --cap.` | The cap was reached. Raise `--cap` if you accept the cost. |
| `N calls are pending (still running at the provider). Run the same command again to collect them.` | Wait and run the same command. Pending runs are not charged twice. |
| `The technology was not found` | The reverse search could not resolve the technology name at PredictLeads. Try the exact product name. |
| A provider answers but the technology list is empty | The parser did not recognise the response shape. Fields that are not found stay blank on purpose. Open an issue with the raw response. |
| `No file at <path>` or `Give --domains, --domain or --find.` | Usage errors, exit code 2. |

How to file an issue. Open one at https://github.com/loootai/looot-techstack/issues with the run id (this tool does not print or store it, so give the idempotency key, for example `techstack:tomba:stripe.com`, and the time of the call so the run can be found), the command you used, and the raw response body with secrets removed.

## Status

The test suite passes (31 tests), but it uses fixtures. If a parser fails on a real response, open an issue with the raw response body (see Troubleshooting).

- No paid looot run was made. Each provider parser is built from the provider's public documentation and from fixtures, not from a recorded paid response. Providers rename fields, and a field that is not found shows as blank, not as a guess.
- The inputs for the reverse search are the least certain part: `TECH` for BuiltWith Lists is documented, but the technology resolver input for PredictLeads (`technology_id_or_name`) and the `technology_id` for its discover call are inferred from the endpoint descriptions.
- The free BuiltWith answer is read as category counts with `latest` and `oldest` times. If its shape differs, the category panel stays empty.
- Dropped on purpose: Sumble (needs an organization id from a separate call), Datagma ($0.065 a domain, same data), list filters such as country and spend, historical trends, and a browser extension.
- A "find companies" search returns the provider's first page, not every site using the technology.

## Install for agents

```bash
git clone https://github.com/loootai/looot-techstack && cd looot-techstack && npm ci
npm run techstack -- --domains examples/domains.csv --dry-run
```

The Claude Code skill is `skills/looot-techstack/SKILL.md` (copy it to `~/.claude/skills/`). `public/llms.txt` summarises the commands. The skill dry-runs first, keeps paid providers opt-in and never raises the cap on its own.

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan
git config core.hooksPath .githooks
```

Stack: TypeScript, Next.js App Router, Tailwind. Built on [looot](https://looot.ai): one key and one prepaid balance for 2,500+ data endpoints, failed calls cost nothing.

## Licence

MIT, copyright looot.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-intent](https://github.com/loootai/looot-intent): account intent and buying-stage scoring (6sense)
- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-signals](https://github.com/loootai/looot-signals): hiring, funding and news triggers (TheirStack, Harmonic)
- [looot-lookalike](https://github.com/loootai/looot-lookalike): lookalike company search (Ocean.io)
- [looot-ads](https://github.com/loootai/looot-ads): competitor ad board (Foreplay)
- [looot-reviews](https://github.com/loootai/looot-reviews): review themes and weak spots (ReviewTrackers)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-mentions](https://github.com/loootai/looot-mentions): brand and keyword listening (Brand24)
- [looot-warm-leads](https://github.com/loootai/looot-warm-leads): warm leads from LinkedIn intent signals (Gojiberry)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts
