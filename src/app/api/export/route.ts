import { requireAdminRoute } from "@/lib/auth/guard";
import { getResults } from "@/lib/app";
import { renderCsv } from "@/headless/render";

export const runtime = "nodejs";

/** Admin. Every stored domain and technology as a CSV. Never cached. */
export async function GET(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const { results } = await getResults();
  return new Response(renderCsv(results), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="techstack.csv"', "Cache-Control": "no-store" } });
}
