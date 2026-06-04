import { NextRequest, NextResponse } from "next/server";
import { DEMO_VISITOR_ID, getDb, type LifeEventRow } from "@/lib/db";
import { getVisitor, withVisitorCookie } from "@/lib/visitor";

export const runtime = "nodejs";

// Last seven days of life_events, newest first. Used by the timeline
// on the feed page.
export async function GET(request: NextRequest) {
  const db = getDb();
  const visitor = getVisitor(request);
  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  const rows = db
    .prepare(
      `SELECT id, category, content, mood, occurred_at, source_message_id, created_at
       FROM life_events
       WHERE visitor_id IN (?, ?) AND occurred_at >= ?
       ORDER BY occurred_at DESC
       LIMIT 200`,
    )
    .all(DEMO_VISITOR_ID, visitor.visitorId, sevenDaysAgo) as LifeEventRow[];
  return withVisitorCookie(NextResponse.json({ events: rows }), visitor);
}
