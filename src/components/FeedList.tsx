"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MiniOrb } from "./MiniOrb";
import { RelatedEvents, type LifeEvent } from "./EventTimeline";

type Feedback = "agreed" | "inaccurate" | null;

type Observation = {
  id: number;
  kind: "observation" | "suggestion" | "question";
  title: string;
  body: string;
  related_event_ids: string;
  created_at: number;
  feedback: Feedback;
  feedback_at: number | null;
  user_reply: string | null;
  user_reply_at: number | null;
};

const KIND_LABEL: Record<Observation["kind"], string> = {
  observation: "观察到",
  suggestion: "也许",
  question: "想问",
};

const KIND_STYLE: Record<Observation["kind"], string> = {
  observation: "text-secondary",
  suggestion: "text-accent",
  question: "text-[#8e5cd1]",
};

async function fetchFeed(): Promise<Observation[]> {
  const d = await fetch("/api/feed").then((r) => r.json());
  return d.observations ?? [];
}

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function show(msg: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(msg);
    timerRef.current = setTimeout(() => setToast(null), 2200);
  }
  return { toast, show };
}

async function fetchEvents(): Promise<LifeEvent[]> {
  const d = await fetch("/api/events").then((r) => r.json());
  return d.events ?? [];
}

export function FeedList() {
  const [items, setItems] = useState<Observation[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { toast, show: showToast } = useToast();

  // Initial load
  useEffect(() => {
    Promise.all([fetchFeed(), fetchEvents()])
      .then(([obs, evs]) => {
        setItems(obs);
        setEvents(evs);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Auto-poll every 30s while tab is visible — picks up observations that
  // the background observer generated after the user sent a chat message.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    function refreshBoth() {
      fetchFeed().then(setItems).catch(() => {});
      fetchEvents().then(setEvents).catch(() => {});
    }
    function startPoll() {
      timer = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        refreshBoth();
      }, 30_000);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") refreshBoth();
    }
    startPoll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/feed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "出错了");
      if (data.ok === false && data.reason === "not_enough_events") {
        setMessage(data.message || "再多聊一点。");
      }
      const [obs, evs] = await Promise.all([fetchFeed(), fetchEvents()]);
      setItems(obs);
      setEvents(evs);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "出错了");
    } finally {
      setRefreshing(false);
    }
  }

  function handleFeedback(id: number, next: Feedback) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, feedback: next } : p)));
  }

  function handleReply(id: number, reply: string | null) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, user_reply: reply } : p)));
  }

  const eventsById = useMemo(() => {
    const m = new Map<number, LifeEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <MiniOrb variant="light" />
      <div className="mx-auto max-w-3xl px-6 pt-12 pb-24">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="text-[40px] font-semibold tracking-tight leading-tight">
              观察
            </h1>
            <p className="mt-2 text-[15px] text-secondary">
              AI 在远处看着你的生活，写下它注意到的事。
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full bg-foreground text-white text-[13px] font-medium transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
          >
            {refreshing ? (
              <><Spinner /> 在看…</>
            ) : (
              <><RefreshIcon /> 让 ta 看看</>
            )}
          </button>
        </div>

        {message && (
          <div className="mb-8 px-5 py-4 rounded-2xl bg-accent-soft text-[14px] text-foreground">
            {message}
          </div>
        )}

        {loaded && items.length === 0 && !message && (
          <EmptyState onRefresh={refresh} refreshing={refreshing} />
        )}

        <div className="flex flex-col gap-4">
          {items.map((o) => (
            <Card
              key={o.id}
              obs={o}
              eventsById={eventsById}
              onFeedback={(next) => handleFeedback(o.id, next)}
              onReply={(reply) => handleReply(o.id, reply)}
              onToast={showToast}
            />
          ))}
        </div>
      </div>

      {/* Toast */}
      <div
        aria-live="polite"
        className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
          toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
        }`}
      >
        <div className="px-5 py-3 rounded-full bg-foreground/90 backdrop-blur text-white text-[13px] whitespace-nowrap shadow-lg">
          {toast}
        </div>
      </div>
    </div>
  );
}

function Card({
  obs,
  eventsById,
  onFeedback,
  onReply,
  onToast,
}: {
  obs: Observation;
  eventsById: Map<number, LifeEvent>;
  onFeedback: (next: Feedback) => void;
  onReply: (reply: string | null) => void;
  onToast: (msg: string) => void;
}) {
  // Resolve the event IDs the Observer cited into actual event rows.
  // Silently skip IDs we can't find (older than the 7-day window).
  const relatedEvents: LifeEvent[] = useMemo(() => {
    let ids: number[] = [];
    try {
      ids = JSON.parse(obs.related_event_ids || "[]");
    } catch {
      ids = [];
    }
    return ids
      .map((id) => eventsById.get(id))
      .filter((e): e is LifeEvent => Boolean(e));
  }, [obs.related_event_ids, eventsById]);
  const [submitting, setSubmitting] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(obs.user_reply ?? "");
  const [replySaving, setReplySaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When reply panel opens, focus textarea
  useEffect(() => {
    if (replyOpen) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [replyOpen]);

  async function setFeedback(next: Feedback) {
    if (submitting) return;
    const target: Feedback = obs.feedback === next ? null : next;
    setSubmitting(true);
    onFeedback(target);
    try {
      const res = await fetch(`/api/feed/${obs.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: target }),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (target === "agreed") onToast("记下了，下次会延续这个视角");
      else if (target === "inaccurate") onToast("记下了，下次会换个角度看");
      else onToast("已取消标记");
    } catch {
      onFeedback(obs.feedback);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply() {
    const text = replyText.trim() || null;
    setReplySaving(true);
    onReply(text); // optimistic
    try {
      const res = await fetch(`/api/feed/${obs.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setReplyOpen(false);
    } catch {
      onReply(obs.user_reply); // revert
    } finally {
      setReplySaving(false);
    }
  }

  function toggleReply() {
    if (replyOpen) {
      setReplyOpen(false);
      return;
    }
    setReplyText(obs.user_reply ?? "");
    setReplyOpen(true);
  }

  return (
    <article className="bg-white border border-separator-soft rounded-3xl px-7 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_28px_-16px_rgba(0,0,0,0.12)] transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-[11px] uppercase tracking-[0.12em] font-medium ${KIND_STYLE[obs.kind]}`}>
          {KIND_LABEL[obs.kind]}
        </span>
        <span className="text-[11px] text-tertiary">· {formatRelative(obs.created_at)}</span>
      </div>

      <h2 className="text-[19px] font-semibold tracking-tight leading-snug">
        {obs.title}
      </h2>
      <p className="mt-2 text-[15px] leading-[1.65] text-foreground/85">
        {obs.body}
      </p>

      {/* Events the Observer was looking at when it wrote this */}
      <RelatedEvents events={relatedEvents} />

      {/* Existing reply */}
      {obs.user_reply && !replyOpen && (
        <div className="mt-4 flex gap-2.5 items-start">
          <span className="mt-[3px] shrink-0 text-[10px] text-tertiary uppercase tracking-widest">你</span>
          <p className="text-[14px] leading-[1.6] text-secondary italic">{obs.user_reply}</p>
        </div>
      )}

      {/* Reply input panel */}
      {replyOpen && (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="说说你的想法…"
            rows={2}
            className="w-full resize-none rounded-2xl border border-separator bg-canvas px-4 py-3 text-[14px] leading-[1.6] outline-none placeholder:text-tertiary focus:border-black/20 transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitReply();
              }
              if (e.key === "Escape") setReplyOpen(false);
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setReplyOpen(false)}
              className="h-7 px-3 rounded-full text-[12px] text-secondary hover:bg-black/[0.04] transition-colors"
            >
              取消
            </button>
            <button
              onClick={submitReply}
              disabled={replySaving}
              className="h-7 px-3 rounded-full text-[12px] font-medium bg-foreground text-white disabled:opacity-50 transition-opacity"
            >
              {replySaving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-separator-soft flex items-center justify-between gap-1">
        {/* Reply toggle */}
        <button
          onClick={toggleReply}
          className="h-7 px-3 rounded-full text-[12px] text-tertiary hover:text-secondary hover:bg-black/[0.04] transition-colors"
        >
          {obs.user_reply ? "编辑回复" : "回复"}
        </button>

        {/* Feedback */}
        <div className="flex items-center gap-1">
          <FeedbackButton
            active={obs.feedback === "agreed"}
            dim={obs.feedback === "inaccurate"}
            disabled={submitting}
            onClick={() => setFeedback("agreed")}
            label="准"
          />
          <FeedbackButton
            active={obs.feedback === "inaccurate"}
            dim={obs.feedback === "agreed"}
            disabled={submitting}
            onClick={() => setFeedback("inaccurate")}
            label="不准"
          />
        </div>
      </div>
    </article>
  );
}

function FeedbackButton({
  active, dim, disabled, onClick, label,
}: {
  active: boolean; dim: boolean; disabled: boolean; onClick: () => void; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-7 px-3 rounded-full text-[12px] font-medium transition-colors ${
        active
          ? "bg-foreground text-white"
          : dim
            ? "text-tertiary/60 hover:text-secondary"
            : "text-secondary hover:bg-black/[0.04]"
      } disabled:opacity-60`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function EmptyState({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="mt-16 text-center">
      <p className="text-[17px] text-secondary leading-relaxed">
        这里还空着。
        <br />
        先去
        <Link href="/" className="text-accent"> 记录 </Link>
        几件最近发生的事，再回来让 ta 看看。
      </p>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-8 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-foreground text-white text-[14px] font-medium hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-60"
      >
        现在就让 ta 看看
      </button>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8M13.5 8a5.5 5.5 0 0 1-9.5 3.8M12 1.5v3h-3M4 14.5v-3h3"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function formatRelative(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const dKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const yesterdayKey = (() => {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`;
  })();

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const month = d.getMonth() + 1;
  const day = d.getDate();

  if (dKey === todayKey) return `今天 ${hh}:${mm}`;
  if (dKey === yesterdayKey) return `昨天 ${hh}:${mm}`;
  if (d.getFullYear() === now.getFullYear()) return `${month} 月 ${day} 日`;
  return `${d.getFullYear()} 年 ${month} 月 ${day} 日`;
}
