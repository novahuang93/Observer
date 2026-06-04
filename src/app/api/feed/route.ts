import { NextRequest, NextResponse } from "next/server";
import { DEMO_VISITOR_ID, getDb, type ObservationRow } from "@/lib/db";
import { runObserver } from "@/lib/agents/observer";
import { getVisitor, withVisitorCookie } from "@/lib/visitor";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const db = getDb();
  const visitor = getVisitor(request);
  const rows = db
    .prepare(
      `SELECT
         o.id,
         o.kind,
         o.title,
         o.body,
         o.related_event_ids,
         o.created_at,
         i.feedback,
         i.feedback_at,
         i.user_reply,
         i.user_reply_at
       FROM observations o
       LEFT JOIN observation_interactions i
         ON i.observation_id = o.id AND i.visitor_id = ?
       WHERE o.visitor_id IN (?, ?)
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 50`,
    )
    .all(visitor.visitorId, DEMO_VISITOR_ID, visitor.visitorId) as ObservationRow[];
  return withVisitorCookie(NextResponse.json({ observations: rows }), visitor);
}

export async function POST(request: NextRequest) {
  const visitor = getVisitor(request);
  try {
    const result = await runObserver(visitor.visitorId);
    if (!result.hadEnoughData) {
      return withVisitorCookie(NextResponse.json({
        ok: false,
        reason: "not_enough_events",
        message: "再多聊一点，攒够素材我再来看看。",
      }), visitor);
    }
    return withVisitorCookie(NextResponse.json({
      ok: true,
      created: result.created,
      observations: result.observations,
    }), visitor);
  } catch (err) {
    console.error("[feed] observer failed", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return withVisitorCookie(
      NextResponse.json({ error: msg }, { status: 500 }),
      visitor,
    );
  }
}
