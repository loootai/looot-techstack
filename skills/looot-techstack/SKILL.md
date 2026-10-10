---
name: looot-techstack
description: Find out which technologies a list of websites use, compare several data providers side by side, and find companies that use a given technology. Use when asked what tech stack a company has, which sites use HubSpot or Shopify, or for a BuiltWith or Wappalyzer style lookup.
---

# looot-techstack

Run from the repository root. Needs Node 22.12 or newer and `npm install --ignore-scripts`. A real run needs `LOOOT_TOKEN` (looot Settings, Agent tokens) and a funded balance; a dry run needs neither. See the README headings What you need and Troubleshooting.

1. Dry run first and show the user the exact quote:
   `npm run techstack -- --domains <file> --dry-run`
   Add `--find "<technology>"` for the reverse search.
2. Default providers cost about $0.019 a domain. BuiltWith ($0.0495) and TheirStack ($0.0981) are opt-in with `--providers`. Ask before adding them.
3. Run: `LOOOT_TOKEN=<token> npm run techstack -- --domains <file> --cap <usd>`. The token comes from the user's environment. Never print it or write it to a file.
4. Read `out/techstack.md`. Report technologies by category, and say which ones only one provider named, since those are the least certain.
5. If the output says calls are pending, run the same command again. Pending runs are not charged twice.

Do not raise `--cap` on your own.
