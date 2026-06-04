"use client";

import { useEffect, useState } from "react";

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

export function FeedList() {
  const [items, setItems] = useState<Observation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d: { observations: Observation[] }) => {
        setItems(d.observations ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
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
      const fresh = await fetch("/api/feed").then((r) => r.json());
      setItems(fresh.observations ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "出错了");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
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
            <>
              <Spinner /> 在看…
            </>
          ) : (
            <>
              <RefreshIcon /> 让 ta 看看
            </>
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
            onFeedback={(next) =>
              setItems((prev) =>
                prev.map((p) => (p.id === o.id ? { ...p, feedback: next } : p)),
              )
            }
          />
        ))}
      </div>
      </div>
    </div>
  );
}

function Card({
  obs,
  onFeedback,
}: {
  obs: Observation;
  onFeedback: (next: Feedback) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function setFeedback(next: Feedback) {
    if (submitting) return;
    const target: Feedback = obs.feedback === next ? null : next;
    setSubmitting(true);
    onFeedback(target); // optimistic
    try {
      const res = await fetch(`/api/feed/${obs.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: target }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      onFeedback(obs.feedback); // revert on failure
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="bg-white border border-separator-soft rounded-3xl px-7 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_28px_-16px_rgba(0,0,0,0.12)] transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[11px] uppercase tracking-[0.12em] font-medium ${KIND_STYLE[obs.kind]}`}
        >
          {KIND_LABEL[obs.kind]}
        </span>
        <span className="text-[11px] text-tertiary">
          · {formatRelative(obs.created_at)}
        </span>
      </div>
      <h2 className="text-[19px] font-semibold tracking-tight leading-snug">
        {obs.title}
      </h2>
      <p className="mt-2 text-[15px] leading-[1.65] text-foreground/85">
        {obs.body}
      </p>
      <div className="mt-5 pt-4 border-t border-separator-soft flex items-center justify-end gap-1">
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
    </article>
  );
}

function FeedbackButton({
  active,
  dim,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  dim: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
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

function EmptyState({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="mt-16 text-center">
      <p className="text-[17px] text-secondary leading-relaxed">
        这里还空着。
        <br />
        先去
        <a href="/" className="text-accent">
          {" "}记录{" "}
        </a>
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
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}
