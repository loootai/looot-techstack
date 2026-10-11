import { createHash } from "node:crypto";
import type { State } from "./state";

/** Stored answers to paid requests are kept this long. */
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const MAX_KEYS = 500;

/** Hash of what a paid request asks for: kind, sorted domains or technology, sorted provider ids. */
export function fingerprint(kind: "lookup" | "find", subject: string[] | string, providerIds: string[]): string {
  const subj = Array.isArray(subject) ? [...subject].sort() : subject.trim().toLowerCase();
  return createHash("sha256").update(JSON.stringify([kind, subj, [...providerIds].sort()])).digest("hex");
}

/** A caller key must be short and plain. Anything else is ignored and the derived key is used. */
export function cleanKey(v: unknown): string | undefined {
  return typeof v === "string" && /^[A-Za-z0-9_.:-]{8,100}$/.test(v) ? v : undefined;
}

export type Replay = { kind: "hit"; response: unknown } | { kind: "conflict" } | { kind: "miss"; keys: string[] };

/**
 * Looks up a paid request under two keys: the caller's own, if any, and one derived from the request itself, so two
 * identical requests match even when the caller sends no key. A caller key reused for a different request is a conflict.
 */
export function lookupReplay(state: State, kind: "lookup" | "find", fp: string, callerKey: string | undefined, now: Date): Replay {
  const keys = [...(callerKey ? [`${kind}:${callerKey}`] : []), `${kind}:auto:${fp}`];
  for (const key of keys) {
    const hit = state.idempotency?.[key];
    if (hit && now.getTime() - Date.parse(hit.at) < IDEMPOTENCY_TTL_MS) return hit.fingerprint === fp ? { kind: "hit", response: hit.response } : { kind: "conflict" };
  }
  return { kind: "miss", keys };
}

/** Remembers the answer to a paid request under each key and drops expired or surplus entries. */
export function remember(state: State, keys: string[], fp: string, response: unknown, now: Date): void {
  const live = Object.entries(state.idempotency ?? {}).filter(([, v]) => now.getTime() - Date.parse(v.at) < IDEMPOTENCY_TTL_MS);
  for (const key of keys) live.push([key, { at: now.toISOString(), fingerprint: fp, response }]);
  state.idempotency = Object.fromEntries(live.slice(-MAX_KEYS));
}
