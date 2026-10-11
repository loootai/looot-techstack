import { NextResponse } from "next/server";
import { checkAdmin, denied, requireAdminRoute } from "@/lib/auth/guard";
import { budgetFieldError } from "@/lib/budget";
import { lookupText, PaidRequestError } from "@/lib/app";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Admin. Paid. Needs the session and the CSRF token. The body carries the quote total the caller saw (`quoteMicros`) and
 * may carry an `idempotencyKey`. The cap and the budget are the server's: a budget field in the body is refused, and a cap field is ignored. An identical request is answered from the stored result, not paid again.
 */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const check = await checkAdmin(req.method, req.headers);
  if (!check.ok) return denied(check);
  const b = (await req.json().catch(() => null)) as { text?: string; providers?: string[]; quoteMicros?: unknown; idempotencyKey?: unknown } | null;
  const refused = budgetFieldError(b);
  if (refused) return NextResponse.json({ error: refused }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(await lookupText(b?.text ?? "", b?.providers, { quoteMicros: b?.quoteMicros, idempotencyKey: b?.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined, sid: check.sid }), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof PaidRequestError ? e.status : 400, headers: NO_STORE });
  }
}
