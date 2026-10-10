<p align="center"><img src="assets/hero.png" alt="looot-techstack" width="100%"></p>

# looot-techstack

[![License](https://img.shields.io/github/license/loootai/looot-techstack)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-techstack)](https://github.com/loootai/looot-techstack/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to [BuiltWith](https://builtwith.com/plans) and [Wappalyzer](https://www.wappalyzer.com/pricing/) lookups: what technology a company's website uses, and which companies use a technology. BuiltWith starts at $295 a month and Wappalyzer's paid plans at $250 a month, with a free tier of 50 lookups a month (public pricing pages, read 2026-10-10). This repo runs on one looot key and you pay list price per domain, from $0 up to a few cents.

It asks several technology providers about each domain and shows their answers side by side: technologies by category, which providers named each one, how much the providers agree, and first and last seen dates where a provider gives them.

![Lookup, light](docs/screenshots/lookup-light.png)
![Bulk table, dark](docs/screenshots/bulk-dark.png)

## How it differs from the originals

BuiltWith and Wappalyzer run their own crawlers. This repo does not detect anything itself. It queries the providers behind looot's `company.technographics` job and compares them. That is slower to trust and cheaper to run, and the side-by-side view shows you where providers disagree instead of hiding it. Wappalyzer's browser extension and its own fingerprint database are not replicated.

## Three ways to run

Demo, no account and no token:

```bash
npm ci
npm run demo        # http://localhost:3530, made-up companies with fixture answers
```

Headless CLI:

```bash
npm run techstack -- --domains examples/domains.csv --dry-run     # exact list-price cost, no call
LOOOT_TOKEN=... npm run techstack -- --domains domains.csv --cap 0.50
LOOOT_TOKEN=... npm run techstack -- --domain stripe.com --providers builtwith-free,tomba,predictleads,builtwith
npm run techstack -- --find HubSpot --dry-run                     # companies using a technology
```

Input is one domain per line, comma separated, or a CSV with a `domain` column. URLs are reduced to the host. Output goes to `out/techstack.json`, `techstack.csv` (one row per domain and technology) and `techstack.md`. Answers are stored in `state/techstack.json` for 30 days, so asking again is free.

Web UI on the same engine (`cp .env.example .env.local`, set `LOOOT_TOKEN`, `npm run build && npm start`): a domain lookup, a bulk table with a technology filter and CSV export, and a "find companies" page. Supabase and sign-in are not part of v0.1. State is one JSON file, so put it behind your own access control.

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

Money rules

- The quote shows before any paid action, line by line. It is exact: each domain and provider pair is one call.
- `--cap` (or `spendCapUsd`) stops a run before a call that would pass it.
- Each call sends a stable idempotency key per (domain, provider), for example `techstack:tomba:stripe.com`. A retry never pays twice.
- A run still in progress when waiting stops is stored as pending. The next run collects it. It is never treated as failed at $0.

## Agreement between providers

For each technology the app shows which providers listed it and "2 of 3": how many of the providers that returned a technology list named it. A provider that failed, is pending or only returns category counts does not count in the base. Technology names are matched by a normalised key (case, punctuation and a `.js` suffix are ignored, and a short alias list covers cases such as AWS and Amazon Web Services). Two providers that spell a product differently beyond that will show as two technologies. Add the spelling to `ALIASES` in `src/lib/parse.ts`. The overlap panel shows shared technologies and a percentage for each pair of providers.

## Install for agents

```bash
git clone https://github.com/loootai/looot-techstack && cd looot-techstack && npm ci
npm run techstack -- --domains examples/domains.csv --dry-run
```

The Claude Code skill is `skills/looot-techstack/SKILL.md` (copy it to `~/.claude/skills/`). `public/llms.txt` summarises the commands. The skill dry-runs first, keeps paid providers opt-in and never raises the cap on its own.

## What is not tested

- No paid looot run was made. Each provider parser is built from the provider's public documentation and from fixtures, not from a recorded paid response. Providers rename fields, and a field that is not found shows as blank, not as a guess.
- The inputs for the reverse search are the least certain part: `TECH` for BuiltWith Lists is documented, but the technology resolver input for PredictLeads (`technology_id_or_name`) and the `technology_id` for its discover call are inferred from the endpoint descriptions.
- The free BuiltWith answer is read as category counts with `latest` and `oldest` times. If its shape differs, the category panel stays empty.
- Dropped on purpose: Sumble (needs an organization id from a separate call), Datagma ($0.065 a domain, same data), list filters such as country and spend, historical trends, and a browser extension.
- A "find companies" search returns the provider's first page, not every site using the technology.

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
