import "server-only";

/** Error from the looot API, with the HTTP status and looot's error code when there is one. */
export class LoootError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LoootError";
  }
}

export interface LoootRun {
  runId: string;
  status: string;
  result?: unknown;
  actualCost?: number | string | null;
  error?: { code?: string; message?: string } | null;
  [extra: string]: unknown;
}

export const TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "stopped"]);

export interface LoootClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** How long to keep polling a run that is still queued or running. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The part of the client the runner needs. Tests pass a mock of this. */
export interface LoootRunner {
  runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string, opts?: RunOptions): Promise<LoootRun>;
}

export interface RunOptions {
  /** Let looot try the next provider when the first finds nothing. Only valid for job ids. */
  fallback?: boolean;
}

/** Server-only client for the looot calls this app makes: run an endpoint, read a run, read the balance. */
export class LoootClient implements LoootRunner {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #pollTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: LoootClientOptions) {
    this.#token = opts.token;
    this.#baseUrl = (opts.baseUrl ?? "https://api.looot.ai").replace(/\/+$/, "");
    this.#fetch = opts.fetch ?? fetch;
    this.#pollTimeoutMs = opts.pollTimeoutMs ?? 60_000;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
      throw new LoootError(err?.message ?? `looot returned HTTP ${res.status}`, res.status, err?.code);
    }
    return json as T;
  }

  /**
   * Paid. Runs one endpoint, or a job id with `fallback: true`. The same idempotency key replays the stored run.
   * The same idempotency key replays the stored run and never charges twice.
   */
  run(endpointId: string, input: Record<string, unknown>, idempotencyKey: string, opts: RunOptions = {}): Promise<LoootRun> {
    return this.#request("POST", "/v1/runs?wait=30", { endpointId, input, idempotencyKey, ...(opts.fallback ? { fallback: true } : {}) });
  }

  /** Free. Reads a run again. */
  getRun(runId: string): Promise<LoootRun> {
    return this.#request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
  }

  /** Runs an endpoint and polls until the run ends or the poll timeout passes. */
  async runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string, opts: RunOptions = {}): Promise<LoootRun> {
    let run = await this.run(endpointId, input, idempotencyKey, opts);
    const deadline = Date.now() + this.#pollTimeoutMs;
    while (!TERMINAL_STATUSES.has(run.status) && Date.now() < deadline) {
      await this.#sleep(this.#pollIntervalMs);
      run = await this.getRun(run.runId);
    }
    return run;
  }

  /** Free. Reads the prepaid balance. The body is passed through; balanceUsdOf picks the number out. */
  balance(): Promise<unknown> {
    return this.#request("GET", "/v1/balance");
  }
}

/** true when LOOOT_TOKEN is set on the server. The value itself never leaves this file. */
export function hasLoootToken(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.LOOOT_TOKEN);
}

/** Builds a client from LOOOT_TOKEN. Throws when the token is missing. */
export function loootFromEnv(env: Record<string, string | undefined> = process.env): LoootClient {
  const token = env.LOOOT_TOKEN;
  if (!token) throw new LoootError("LOOOT_TOKEN is not set on the server", 500, "missing_token");
  return new LoootClient({ token, baseUrl: env.LOOOT_API_URL });
}

/** Finds a dollar balance in the balance answer, whatever the field is called. null when there is none. */
export function balanceUsdOf(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  for (const k of ["availableUsd", "balanceUsd", "available", "balance", "funds"]) {
    const v = o[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
    if (v && typeof v === "object") {
      const inner = balanceUsdOf(v);
      if (inner !== null) return inner;
    }
  }
  return null;
}
