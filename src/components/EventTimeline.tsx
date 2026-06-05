"use client";

import { useState } from "react";

export type LifeEvent = {
  id: number;
  category: string;
  content: string;
  mood: string | null;
  occurred_at: number;
};

export const CATEGORY_LABEL: Record<string, string> = {
  work: "工作",
  social: "社交",
  health: "身体",
  emotion: "情绪",
  hobby: "兴趣",
  daily: "日常",
};

export const MOOD_LABEL: Record<string, string> = {
  frustrated: "受挫",
  relaxed: "放松",
  low: "低落",
  tired: "疲倦",
  focused: "专注",
  energized: "充满能量",
  neutral: "平淡",
  inspired: "受触动",
  embarrassed: "尴尬",
  mixed: "复杂",
};

/**
 * Day-grouped timeline of life_events. By default shows the section
 * shell ("最近七天") that fits inside a feed; pass `bare` when the
 * timeline IS the page (Events page) and the page already has a title.
 */
export function EventTimeline({
  events,
  bare = false,
}: {
  events: LifeEvent[];
  bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Capture "now" once at mount so the render pass stays pure.
  const [now] = useState(() => Date.now());
  const D = 86_400_000;
  const todayK = dayKey(new Date(now));
  const yesterdayK = dayKey(new Date(now - D));

  // Group by day, newest day first
  const groups = new Map<string, LifeEvent[]>();
  const sorted = [...events].sort((a, b) => b.occurred_at - a.occurred_at);
  for (const e of sorted) {
    const k = dayKey(new Date(e.occurred_at));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1));
  const alwaysVisibleKeys = orderedKeys.filter(
    (k) => k === todayK || k === yesterdayK,
  );
  const collapsedKeys = orderedKeys.filter(
    (k) => k !== todayK && k !== yesterdayK,
  );
  const visibleKeys = open ? orderedKeys : alwaysVisibleKeys;
  const hiddenCount = collapsedKeys.reduce(
    (n, k) => n + groups.get(k)!.length,
    0,
  );

  function dayLabel(k: string, ts: number): string {
    if (k === todayK) return "今天";
    if (k === yesterdayK) return "昨天";
    const d = new Date(ts);
    const days = Math.round((now - d.getTime()) / D);
    if (days <= 7) return `${days} 天前`;
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  if (orderedKeys.length === 0) return null;

  const body = (
    <div className="flex flex-col gap-4">
      {visibleKeys.map((k) => (
        <div key={k} className="grid grid-cols-[64px_1fr] gap-4 items-start">
          <div className="text-[12px] text-tertiary pt-1.5">
            {dayLabel(k, groups.get(k)![0].occurred_at)}
          </div>
          <div className="flex flex-col gap-1.5">
            {groups.get(k)!.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </div>
      ))}
      {collapsedKeys.length > 0 && (
        <div className="flex justify-center mt-1">
          <button
            onClick={() => setOpen((v) => !v)}
            className="h-7 px-3.5 rounded-full text-[12px] text-secondary hover:bg-black/[0.04] transition-colors"
          >
            {open
              ? `收起 ${collapsedKeys.length} 天`
              : `展开更早的 ${collapsedKeys.length} 天 · ${hiddenCount} 件`}
          </button>
        </div>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <section className="mb-10 px-6 py-6 rounded-3xl bg-white border border-separator-soft">
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">最近七天</h2>
          <p className="mt-1 text-[12px] text-tertiary">ta 看到的，是这些事</p>
        </div>
        <span className="text-[12px] text-tertiary">{events.length} 件</span>
      </div>
      {body}
    </section>
  );
}

export function EventRow({ event }: { event: LifeEvent }) {
  const cat = event.category;
  return (
    <div className="flex gap-3 px-2 py-1.5 rounded-lg transition-colors hover:bg-black/[0.02]">
      <div className={`w-[3px] rounded-full shrink-0 tl-event-bar cat-${cat}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 text-[11px]">
          <span className={`font-medium tl-cat cat-${cat}`}>
            {CATEGORY_LABEL[cat] ?? cat}
          </span>
          {event.mood && (
            <>
              <span className="text-tertiary">·</span>
              <span className="text-tertiary">
                {MOOD_LABEL[event.mood] ?? event.mood}
              </span>
            </>
          )}
        </div>
        <p className="text-[13.5px] leading-[1.5] text-foreground">
          {event.content}
        </p>
      </div>
    </div>
  );
}

/**
 * Compact inline list of events — used inside observation cards
 * to ground the AI's interpretation in the facts it noticed.
 */
export function RelatedEvents({ events }: { events: LifeEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mt-5 rounded-2xl bg-canvas/60 border border-separator-soft px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-tertiary mb-2">
        它注意到的
      </div>
      <div className="flex flex-col gap-1">
        {events.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
