import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { releaseCommit } from "@/lib/release";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, commit: releaseCommit() });
  } catch {
    return NextResponse.json({ ok: false, commit: releaseCommit() }, { status: 503 });
  }
}
