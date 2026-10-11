import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type TechstackConfig } from "./config";
import { withFileLock } from "./fileLock";
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

/** Writes through a temp file so a crash never leaves half a file. The temp name is unique, so two writers never share one. */
export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state)}\n`);
  renameSync(tmp, path);
}

/** What a request loaded, so that at the end it can tell what it changed. */
export interface StateSnapshot {
  lookups: Record<string, LookupRecord>;
  searches: Record<string, SearchRecord>;
  calls: number;
}

/** Take this right after `loadState`. The records are shared, not copied, so a record that changes later no longer matches. */
export function snapshotState(s: State): StateSnapshot {
  return { lookups: { ...s.lookups }, searches: { ...s.searches }, calls: s.calls.length };
}

const newer = <T extends { at: string }>(mine: T, theirs: T | undefined): boolean => !theirs || theirs.at <= mine.at;

/**
 * Saves what this request changed without losing what others saved meanwhile. It takes the state file's lock, reads the
 * file again, adds this request's new or changed records and calls (the newer record wins), lets `after` add more (such as
 * the stored reply), and writes the file. A plain `saveState` after a long paid run would overwrite another request's answers.
 */
export async function commitState(path: string, state: State, snap: StateSnapshot, after?: (fresh: State) => void): Promise<State> {
  return withFileLock(path, () => {
    const fresh = loadState(path);
    for (const [k, v] of Object.entries(state.lookups)) if (snap.lookups[k] !== v && newer(v, fresh.lookups[k])) fresh.lookups[k] = v;
    for (const [k, v] of Object.entries(state.searches)) if (snap.searches[k] !== v && newer(v, fresh.searches[k])) fresh.searches[k] = v;
    fresh.calls.push(...state.calls.slice(snap.calls));
    after?.(fresh);
    saveState(path, fresh);
    return fresh;
  });
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
