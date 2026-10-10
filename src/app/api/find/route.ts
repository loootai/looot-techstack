import { NextResponse } from "next/server";
import { findTech } from "@/lib/app";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { tech?: string; providers?: string[] } | null;
  if (!b?.tech?.trim()) return NextResponse.json({ error: "tech is required" }, { status: 400 });
  try {
    return NextResponse.json(await findTech(b.tech.trim(), b.providers));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
