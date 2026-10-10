import { NextResponse } from "next/server";
import { quoteFindText, quoteText } from "@/lib/app";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { kind?: string; text?: string; tech?: string; providers?: string[] } | null;
  if (!b) return NextResponse.json({ error: "bad body" }, { status: 400 });
  if (b.kind === "find") return NextResponse.json({ quote: await quoteFindText(b.tech ?? "", b.providers), invalid: [] });
  return NextResponse.json(await quoteText(b.text ?? "", b.providers));
}
