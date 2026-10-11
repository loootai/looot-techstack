# Changelog

## 0.1.4

Spend limits, version 2. Before this, a paid run was limited by the cap per run, an in-memory rate limit, the 24-hour replay of identical requests and the token balance. Nothing limited spend across different requests, and two different requests started together could both pass the cap. The state file was also overwritten at the end of each request, so two requests running at once could lose each other's stored answers and pay again later.

- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json` next to the state file. The signed-in owner changes it on the new Costs page (`PUT /api/budget`, session and CSRF token). A lookup or find request cannot carry a budget (refused with 400) and a cap field in a request is ignored. The cap per run stays `spendCapUsd` in the config.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is refused if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back if looot answered with an error. A call still running keeps its reservation and is never counted as $0. The next paid request looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- A paid request that does not fit what is left of the budget is refused with 409 and a message naming the limit. The CLI refuses it too (exit 2) unless `--partial` is passed.
- Lock around state writes: the state file is saved under a lock file and merged with what other requests saved meanwhile.
- Stable idempotency keys: one key per (provider, domain or technology, cache period), with no date or time in it. The period is `floor(time / cacheDays)`, so the key changes only once a stored answer is stale, and looot then buys fresh data instead of replaying the old run. A finished call is also stored under its key in `budget.json`. The existing 24-hour replay of identical requests and the in-flight dedupe are unchanged.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month.
- README: the Spending and Securing a deployment sections describe the new limits. The looot token balance is still the final limit.

Migration: none. This app has no database. `budget.json` is created on first use. The first paid lookup for a pair without a fresh stored answer after the upgrade uses a new key and is charged once. Run one instance on a persistent disk, since the file is not shared between hosts.

## 0.1.3

Admin sign-in for every admin page and route, CSRF protection, a server-side spend cap per run, and replay of identical paid requests.
