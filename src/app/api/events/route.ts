import { getDb, type LifeEventRow } from "@/lib/db";

export const runtime = "nodejs";

// Last seven days of life_events, newest first. Used by the timeline
// on the feed page.
export async function GET() {
  const db = getDb();
  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  const rows = db
    .prepare(
      `SELECT id, category, content, mood, occurred_at, source_message_id, created_at
       FROM life_events
       WHERE occurred_at >= ?
       ORDER BY occurred_at DESC
       LIMIT 200`,
    )
    .all(sevenDaysAgo) as LifeEventRow[];
  return Response.json({ events: rows });
}
