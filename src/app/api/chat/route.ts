import { NextRequest } from "next/server";
import { getDb, getProfile, type MessageRow } from "@/lib/db";
import { ensureGreeting, runRecorder } from "@/lib/agents/recorder";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  // First-time visitor: seed the greeting so the chat has something to read.
  ensureGreeting();
  const rows = db
    .prepare(
      "SELECT id, role, content, created_at FROM messages ORDER BY id ASC LIMIT 500",
    )
    .all() as MessageRow[];
  const profile = getProfile(db);
  return Response.json({
    messages: rows,
    profile: profile
      ? { display_name: profile.display_name }
      : { display_name: null },
  });
}

export async function POST(request: NextRequest) {
  const { message } = (await request.json()) as { message?: unknown };
  if (typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > 4000) {
    return Response.json({ error: "message too long" }, { status: 400 });
  }

  try {
    const result = await runRecorder(message.trim());
    return Response.json({
      assistantMessageId: result.assistantMessageId,
      assistantText: result.assistantText,
      eventsRecorded: result.eventsRecorded,
      nameCaptured: result.nameCaptured,
    });
  } catch (err) {
    console.error("[chat] recorder failed", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
