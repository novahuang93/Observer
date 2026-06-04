"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MiniOrb } from "./MiniOrb";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

type DraftMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

type ThreadItem = Message | DraftMessage;

function isReal(m: ThreadItem): m is Message {
  return typeof m.id === "number";
}

export function ChatThread() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d: { messages: Message[] }) => {
        setMessages(d.messages ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // While a message is in flight, poll for the assistant's response in case
  // the original POST is slow or got dropped (e.g. user switched tab). The
  // server is the source of truth; whoever returns the new assistant message
  // first wins.
  const lastKnownId = messages[messages.length - 1]?.id ?? 0;
  useEffect(() => {
    if (!sending) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await fetch("/api/chat").then((r) => r.json());
        if (cancelled) return;
        const fresh: Message[] = d.messages ?? [];
        const newAssistant = fresh.find(
          (m) => m.role === "assistant" && m.id > lastKnownId,
        );
        if (newAssistant) {
          setMessages(fresh);
          setDrafts([]);
          setSending(false);
        }
      } catch {
        /* keep trying */
      }
    };
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sending, lastKnownId]);

  // When the tab regains visibility, refresh — catches the case where the
  // user switched away during a slow response and came back.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      fetch("/api/chat")
        .then((r) => r.json())
        .then((d: { messages: Message[] }) => {
          setMessages(d.messages ?? []);
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, drafts, scrollToBottom]);

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [input, autosize]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);

    const userDraftId = `u-${Date.now()}`;
    const assistantDraftId = `a-${Date.now()}`;
    setDrafts([
      { id: userDraftId, role: "user", content: text },
      { id: assistantDraftId, role: "assistant", content: "", pending: true },
    ]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "出错了");

      // Re-fetch the full thread so server is the source of truth.
      const fresh = await fetch("/api/chat").then((r) => r.json());
      setMessages(fresh.messages ?? []);
      setDrafts([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "出错了";
      setError(msg);
      setDrafts([]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const grouped = groupByDate(messages);

  // First-time ceremonial layout: only the seeded greeting exists and the
  // user hasn't typed anything yet. We swap in the orb + centered input
  // until they send their first message.
  const isFirstTime =
    loaded &&
    messages.length === 1 &&
    messages[0].role === "assistant" &&
    drafts.length === 0;

  if (isFirstTime) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 pb-12">
        <MiniOrb variant="dark" />
        <div className="welcome-in-1 orb" aria-hidden="true">
          <div className="orb-halo-wide" />
          <div className="orb-halo" />
          <div className="orb-core" />
        </div>
        <p className="welcome-in-2 mt-14 max-w-md text-center text-[17px] leading-[1.75] text-foreground whitespace-pre-wrap">
          {messages[0].content}
        </p>
        <div className="welcome-in-3 mt-10 w-full max-w-md">
          {error && (
            <div className="mb-3 text-center text-[13px] text-red-600/90">
              {error}
            </div>
          )}
          <div className="flex items-end gap-2 p-2 pl-4 bg-white border border-separator rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-12px_rgba(0,0,0,0.16)]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="怎么称呼你？"
              rows={1}
              autoFocus
              className="flex-1 resize-none outline-none bg-transparent text-[15px] leading-6 py-2 placeholder:text-tertiary"
              disabled={sending}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-foreground text-white transition-all duration-150 hover:scale-[1.03] active:scale-95 disabled:bg-black/[0.08] disabled:text-tertiary disabled:hover:scale-100"
              aria-label="发送"
            >
              <ArrowUp />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <MiniOrb variant="dark" />
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="mx-auto max-w-3xl px-6 pt-10 pb-40">
          {loaded && messages.length === 0 && drafts.length === 0 && (
            <EmptyState />
          )}
          {grouped.earlier.length > 0 && (
            <EarlierDisclosure groups={grouped.earlier} />
          )}
          {grouped.today.length > 0 && (
            <div className="flex flex-col gap-3">
              {grouped.today.map((m) => (
                <Bubble key={`m-${m.id}`} message={m} />
              ))}
            </div>
          )}
          {drafts.length > 0 && (
            <div className="flex flex-col gap-3 mt-3">
              {drafts.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-canvas via-canvas to-canvas/0 pt-8 pb-6">
        <div className="mx-auto max-w-3xl px-6">
          {error && (
            <div className="mb-3 text-[13px] text-red-600/90">{error}</div>
          )}
          <div className="flex items-end gap-2 p-2 pl-4 bg-white border border-separator rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="今天发生了什么？"
              rows={1}
              className="flex-1 resize-none outline-none bg-transparent text-[15px] leading-6 py-2 placeholder:text-tertiary"
              disabled={sending}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-foreground text-white transition-all duration-150 hover:scale-[1.03] active:scale-95 disabled:bg-black/[0.08] disabled:text-tertiary disabled:hover:scale-100"
              aria-label="发送"
            >
              <ArrowUp />
            </button>
          </div>
          <p className="mt-3 text-center text-[11px] text-tertiary">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>
    </div>
  );
}

type DateGroup = { key: string; label: string; messages: Message[] };

function groupByDate(messages: Message[]): {
  today: Message[];
  earlier: DateGroup[];
} {
  const todayKey = dayKey(new Date());
  const yesterdayKey = dayKey(new Date(Date.now() - 86_400_000));
  const buckets = new Map<string, Message[]>();
  for (const m of messages) {
    const k = dayKey(new Date(m.created_at));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(m);
  }
  const today = buckets.get(todayKey) ?? [];
  const earlier: DateGroup[] = [];
  for (const [key, msgs] of buckets.entries()) {
    if (key === todayKey) continue;
    const label =
      key === yesterdayKey ? "昨天" : formatDateLabel(msgs[0].created_at);
    earlier.push({ key, label, messages: msgs });
  }
  earlier.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { today, earlier };
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月 ${d.getDate()}日`;
}

function EarlierDisclosure({ groups }: { groups: DateGroup[] }) {
  const [open, setOpen] = useState(false);
  const count = groups.reduce((n, g) => n + g.messages.length, 0);
  return (
    <div className="mb-6">
      <div className="flex justify-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] text-secondary bg-white border border-separator-soft hover:bg-black/[0.03] transition-colors"
          aria-expanded={open}
        >
          <Chevron open={open} />
          <span>
            {open
              ? `收起之前的 ${groups.length} 天`
              : `之前的 ${groups.length} 天 · ${count} 条`}
          </span>
        </button>
      </div>
      {open && (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="flex items-center gap-3 mb-3">
                <span className="h-px flex-1 bg-separator-soft" />
                <span className="text-[11px] text-tertiary tracking-wider">
                  {g.label}
                </span>
                <span className="h-px flex-1 bg-separator-soft" />
              </div>
              <div className="flex flex-col gap-3">
                {g.messages.map((m) => (
                  <Bubble key={`m-${m.id}`} message={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Bubble({ message }: { message: ThreadItem }) {
  const isUser = message.role === "user";
  const pending = !isReal(message) && message.pending;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-4 py-2.5 text-[15px] leading-[1.55] whitespace-pre-wrap break-words ${
          isUser
            ? "bg-bubble-user text-white rounded-3xl rounded-br-lg"
            : "bg-bubble-assistant text-foreground rounded-3xl rounded-bl-lg"
        }`}
      >
        {pending ? <Typing /> : message.content}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <Dot delay={0} />
      <Dot delay={150} />
      <Dot delay={300} />
    </span>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"
      style={{ animationDelay: `${delay}ms`, animationDuration: "1.2s" }}
    />
  );
}

function ArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 13V3M8 3L3.5 7.5M8 3L12.5 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="mt-20 text-center">
      <h1 className="text-[34px] font-semibold tracking-tight text-foreground leading-tight">
        说点什么。
      </h1>
      <p className="mt-3 text-[15px] text-secondary leading-relaxed">
        今天怎么样？开心、累、有点烦躁、突然想起一件事——都可以。
        <br />
        我只是在听，不点评。
      </p>
    </div>
  );
}
