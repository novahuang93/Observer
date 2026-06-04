import { NextRequest, NextResponse } from "next/server";
import { DEMO_VISITOR_ID, getDb, getProfile, type MessageRow } from "@/lib/db";
import { runRecorder } from "@/lib/agents/recorder";
import { runObserver } from "@/lib/agents/observer";
import { getVisitor, withVisitorCookie } from "@/lib/visitor";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const db = getDb();
  const visitor = getVisitor(request);
  const rows = db
    .prepare(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE visitor_id IN (?, ?)
       ORDER BY created_at ASC, id ASC
       LIMIT 500`,
    )
    .all(DEMO_VISITOR_ID, visitor.visitorId) as MessageRow[];
  const profile = getProfile(db, visitor.visitorId);
  return withVisitorCookie(NextResponse.json({
    messages: rows,
    profile: profile
      ? { display_name: profile.display_name }
      : { display_name: null },
  }), visitor);
}

export async function POST(request: NextRequest) {
  const visitor = getVisitor(request);
  const { message } = (await request.json()) as { message?: unknown };
  if (typeof message !== "string" || message.trim().length === 0) {
    return withVisitorCookie(
      NextResponse.json({ error: "message is required" }, { status: 400 }),
      visitor,
    );
  }
  if (message.length > 4000) {
    return withVisitorCookie(
      NextResponse.json({ error: "message too long" }, { status: 400 }),
      visitor,
    );
  }

  try {
    const result = await runRecorder(visitor.visitorId, message.trim());

    // Fire-and-forget: if new life events were recorded, let Observer run
    // in the background so the feed updates without the user having to
    // manually trigger it.
    if (result.eventsRecorded > 0) {
      runObserver(visitor.visitorId).catch((err) =>
        console.error("[chat] background observer failed:", err),
      );
    }

    return withVisitorCookie(NextResponse.json({
      assistantMessageId: result.assistantMessageId,
      assistantText: result.assistantText,
      eventsRecorded: result.eventsRecorded,
      nameCaptured: result.nameCaptured,
    }), visitor);
  } catch (err) {
    console.error("[chat] recorder failed", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return withVisitorCookie(
      NextResponse.json({ error: msg }, { status: 500 }),
      visitor,
    );
  }
}
