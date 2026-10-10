import { NextResponse } from "next/server";
import { lookupText } from "@/lib/app";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { text?: string; providers?: string[] } | null;
  try {
    return NextResponse.json(await lookupText(b?.text ?? "", b?.providers));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
