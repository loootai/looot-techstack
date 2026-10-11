import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type TechstackConfig } from "./config";
import type { CallRecord, LookupRecord, SearchRecord } from "./types";

/** Everything the app remembers: one JSON file, or memory in demo mode. Domains and technologies are public data, so nothing here needs retention rules. */
export interface State {
  version: 1;
  lookups: Record<string, LookupRecord>;
  searches: Record<string, SearchRecord>;
  calls: CallRecord[];
  /** Answers to paid requests, so the same request is not paid for twice. Kept 24 hours. */
  idempotency?: Record<string, { at: string; fingerprint: string; response: unknown }>;
}

export const emptyState = (): State => ({ version: 1, lookups: {}, searches: {}, calls: [] });

export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  const s = JSON.parse(readFileSync(path, "utf8")) as State;
  return s.version === 1 ? s : emptyState();
}

/** Writes through a temp file so a crash never leaves half a file. */
export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state)}\n`);
  renameSync(tmp, path);
}

export function loadConfig(path: string): TechstackConfig {
  return existsSync(path) ? parseConfig(readFileSync(path, "utf8")) : DEFAULT_CONFIG;
}

export function saveConfig(path: string, c: TechstackConfig): void {
  writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`);
}

/** Every domain that has at least one stored answer, newest first. */
export function knownDomains(state: State): string[] {
  const latest = new Map<string, string>();
  for (const r of Object.values(state.lookups)) if (!latest.has(r.domain) || r.at > latest.get(r.domain)!) latest.set(r.domain, r.at);
  return [...latest].sort((a, b) => b[1].localeCompare(a[1])).map(([d]) => d);
}
