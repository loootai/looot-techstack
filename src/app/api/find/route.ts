import { NextResponse } from "next/server";
import { checkAdmin, denied, requireAdminRoute } from "@/lib/auth/guard";
import { findTech, PaidRequestError } from "@/lib/app";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/** Admin. Paid. Same rules as /api/lookup: session, CSRF token, the quote total, the server cap, and replay of an identical request. */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const check = await checkAdmin(req.method, req.headers);
  if (!check.ok) return denied(check);
  const b = (await req.json().catch(() => null)) as { tech?: string; providers?: string[]; quoteMicros?: unknown; idempotencyKey?: unknown } | null;
  if (!b?.tech?.trim()) return NextResponse.json({ error: "tech is required" }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(await findTech(b.tech.trim(), b.providers, { quoteMicros: b.quoteMicros, idempotencyKey: b.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined, sid: check.sid }), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof PaidRequestError ? e.status : 400, headers: NO_STORE });
  }
}
