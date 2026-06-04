import { getDb, type ObservationRow } from "@/lib/db";
import { runObserver } from "@/lib/agents/observer";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, kind, title, body, related_event_ids, created_at, feedback, feedback_at
       FROM observations ORDER BY id DESC LIMIT 50`,
    )
    .all() as ObservationRow[];
  return Response.json({ observations: rows });
}

export async function POST() {
  try {
    const result = await runObserver();
    if (!result.hadEnoughData) {
      return Response.json({
        ok: false,
        reason: "not_enough_events",
        message: "再多聊一点，攒够素材我再来看看。",
      });
    }
    return Response.json({
      ok: true,
      created: result.created,
      observations: result.observations,
    });
  } catch (err) {
    console.error("[feed] observer failed", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
