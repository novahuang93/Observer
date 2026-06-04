import { NextRequest, NextResponse } from "next/server";
import { getDb, observationVisibleToVisitor, setObservationFeedback } from "@/lib/db";
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

  const body = (await request.json()) as { feedback?: unknown };
  const raw = body.feedback;
  const feedback =
    raw === "agreed" || raw === "inaccurate"
      ? raw
      : raw === null
        ? null
        : undefined;
  if (feedback === undefined) {
    return withVisitorCookie(
      NextResponse.json(
        { error: "feedback must be 'agreed' | 'inaccurate' | null" },
        { status: 400 },
      ),
      visitor,
    );
  }

  const db = getDb();
  if (!observationVisibleToVisitor(db, observationId, visitor.visitorId)) {
    return withVisitorCookie(
      NextResponse.json({ error: "not found" }, { status: 404 }),
      visitor,
    );
  }

  setObservationFeedback(db, visitor.visitorId, observationId, feedback);
  return withVisitorCookie(
    NextResponse.json({ ok: true, id: observationId, feedback }),
    visitor,
  );
}
