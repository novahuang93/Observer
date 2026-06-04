import { NextRequest, NextResponse } from "next/server";
import { getDb, observationVisibleToVisitor, setObservationReply } from "@/lib/db";
import { getVisitor, withVisitorCookie } from "@/lib/visitor";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const visitor = getVisitor(request);
  const { id } = await ctx.params;
  const observationId = Number(id);
  if (!Number.isFinite(observationId) || observationId <= 0) {
    return withVisitorCookie(
      NextResponse.json({ error: "invalid id" }, { status: 400 }),
      visitor,
    );
  }

  const body = (await request.json()) as { reply?: unknown };
  const raw = body.reply;
  if (raw !== null && typeof raw !== "string") {
    return withVisitorCookie(
      NextResponse.json({ error: "reply must be a string or null" }, { status: 400 }),
      visitor,
    );
  }
  const reply = typeof raw === "string" ? raw.trim() || null : null;

  const db = getDb();
  if (!observationVisibleToVisitor(db, observationId, visitor.visitorId)) {
    return withVisitorCookie(
      NextResponse.json({ error: "not found" }, { status: 404 }),
      visitor,
    );
  }

  setObservationReply(db, visitor.visitorId, observationId, reply);
  return withVisitorCookie(
    NextResponse.json({ ok: true, id: observationId, reply }),
    visitor,
  );
}
