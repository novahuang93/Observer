import { NextRequest } from "next/server";
import { getDb, setObservationReply } from "@/lib/db";

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

  const body = (await request.json()) as { reply?: unknown };
  const raw = body.reply;
  if (raw !== null && typeof raw !== "string") {
    return Response.json({ error: "reply must be a string or null" }, { status: 400 });
  }
  const reply = typeof raw === "string" ? raw.trim() || null : null;

  const db = getDb();
  const exists = db
    .prepare("SELECT id FROM observations WHERE id = ?")
    .get(observationId);
  if (!exists) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  setObservationReply(db, observationId, reply);
  return Response.json({ ok: true, id: observationId, reply });
}
