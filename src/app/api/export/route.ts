import { getResults } from "@/lib/app";
import { renderCsv } from "@/headless/render";

export const runtime = "nodejs";

/** Free. Every stored domain and technology as a CSV. */
export async function GET() {
  const { results } = await getResults();
  return new Response(renderCsv(results), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="techstack.csv"' } });
}
