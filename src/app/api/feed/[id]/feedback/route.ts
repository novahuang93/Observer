import { NextRequest } from "next/server";
import { getDb, setObservationFeedback } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const observationId = Number(id);
  if (!Number.isFinite(observationId) || observationId <= 0) {
    return Response.json({ error: "invalid id" }, { status: 400 });
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
    return Response.json(
      { error: "feedback must be 'agreed' | 'inaccurate' | null" },
      { status: 400 },
    );
  }

  const db = getDb();
  // Ensure the row exists before we silently accept.
  const exists = db
    .prepare("SELECT id FROM observations WHERE id = ?")
    .get(observationId);
  if (!exists) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  setObservationFeedback(db, observationId, feedback);
  return Response.json({ ok: true, id: observationId, feedback });
}
