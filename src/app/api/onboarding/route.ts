import { NextRequest, NextResponse } from "next/server";
import { getDb, isOnboarded, markOnboarded, setUserName } from "@/lib/db";
import { runObserver } from "@/lib/agents/observer";
import { getVisitor, withVisitorCookie } from "@/lib/visitor";

export const runtime = "nodejs";

type Body = {
  name?: string;
  answers?: string[];
  skip?: boolean;
};

/**
 * One-shot endpoint for the new-visitor onboarding flow:
 *
 *   - `skip: true` — visitor opted out of the intro. Mark them as
 *     onboarded so we don't ask again, return immediately.
 *
 *   - Otherwise — set their name (if provided), insert each non-empty
 *     answer as a life_event, run the Observer to write the first
 *     observation rooted in what they just shared, mark onboarded.
 */
export async function POST(request: NextRequest) {
  const visitor = getVisitor(request);
  const db = getDb();

  // Idempotent: if they already finished onboarding, no-op.
  if (isOnboarded(db, visitor.visitorId)) {
    return withVisitorCookie(
      NextResponse.json({ ok: true, alreadyOnboarded: true }),
      visitor,
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return withVisitorCookie(
      NextResponse.json({ error: "invalid body" }, { status: 400 }),
      visitor,
    );
  }

  if (body.skip === true) {
    markOnboarded(db, visitor.visitorId);
    return withVisitorCookie(
      NextResponse.json({ ok: true, skipped: true }),
      visitor,
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length > 0 && name.length <= 40) {
    setUserName(db, visitor.visitorId, name);
  }

  const answers = Array.isArray(body.answers)
    ? body.answers.filter(
        (a): a is string => typeof a === "string" && a.trim().length > 0,
      )
    : [];

  const now = Date.now();
  const insertEvent = db.prepare(
    `INSERT INTO life_events (visitor_id, category, content, mood, occurred_at, source_message_id, created_at)
     VALUES (?, 'daily', ?, NULL, ?, NULL, ?)`,
  );
  // Stagger the timestamps so the timeline doesn't show them all
  // collapsed at the same minute. Newest answer first.
  const tx = db.transaction((items: string[]) => {
    items.forEach((content, idx) => {
      const ts = now - idx * 60_000;
      insertEvent.run(visitor.visitorId, content.trim(), ts, ts);
    });
  });
  tx(answers);

  // Run the Observer right now (not fire-and-forget) so the user can
  // see the resulting observation when they land on /feed.
  let observationsCreated = 0;
  if (answers.length > 0) {
    try {
      const result = await runObserver(visitor.visitorId, { minEvents: 1 });
      observationsCreated = result.created;
    } catch (err) {
      console.error("[onboarding] observer failed", err);
      // Continue — we still want to mark onboarded and let the user
      // land on /feed (they'll see demo observations at least).
    }
  }

  markOnboarded(db, visitor.visitorId);

  return withVisitorCookie(
    NextResponse.json({
      ok: true,
      answersRecorded: answers.length,
      observationsCreated,
    }),
    visitor,
  );
}
