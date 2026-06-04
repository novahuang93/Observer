"use client";

import { useEffect, useRef, useState } from "react";

const THOUGHTS = [
  "今天天气好像还不错",
  "ta 看起来在赶什么",
  "下午的光，挺温柔",
  "想吃点甜的",
  "嗯…",
  "这一周过得真快",
  "走神了",
  "不知道 ta 今天累不累",
  "窗外好像有人走过",
  "想起来一件事",
  "ta 还没说完呢",
  "咖啡是不是有点多了",
];

type Variant = "dark" | "light";

/**
 * The Observer's quiet presence — a tiny orb in the top-left corner.
 *
 *  - `dark`  variant lives on the chat page as the Recorder Agent.
 *  - `light` variant lives on the feed page as the Observer Agent.
 *
 * It blinks on its own, blinks again when the mouse drifts close, glances
 * left/right while the user scrolls, and occasionally floats a stray
 * thought up from its right side.
 */
export function MiniOrb({ variant = "dark" }: { variant?: Variant }) {
  const orbRef = useRef<HTMLDivElement | null>(null);
  const [thought, setThought] = useState<{ id: number; text: string } | null>(
    null,
  );
  const [glance, setGlance] = useState<"left" | "right" | null>(null);
  const [blinking, setBlinking] = useState(false);

  // ── Thought bubbles ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;

    function schedule(delay: number) {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState !== "visible") {
          schedule(8000);
          return;
        }
        const text = THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)];
        const nextId = ++id;
        setThought({ id: nextId, text });
        // bubble lives 5s, then 3s gap (matches CSS animation length)
        setTimeout(() => {
          if (cancelled) return;
          setThought((cur) => (cur && cur.id === nextId ? null : cur));
        }, 5100);
        schedule(8000);
      }, delay);
    }
    schedule(2000); // first one ~2s after mount
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // ── Mouse-near blink ─────────────────────────────────────────
  useEffect(() => {
    let cooldown = false;
    function onMove(e: MouseEvent) {
      const orb = orbRef.current;
      if (!orb || cooldown) return;
      const rect = orb.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      if (dx * dx + dy * dy < 120 * 120) {
        setBlinking(true);
        cooldown = true;
        setTimeout(() => setBlinking(false), 260);
        setTimeout(() => {
          cooldown = false;
        }, 1400);
      }
    }
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  // ── Scroll glance ────────────────────────────────────────────
  useEffect(() => {
    let lastTop = 0;
    let timer: ReturnType<typeof setTimeout>;
    function onScroll(e: Event) {
      const target = e.target as HTMLElement | Document | null;
      if (!target) return;
      const top =
        target instanceof Document
          ? document.documentElement.scrollTop
          : (target as HTMLElement).scrollTop;
      if (typeof top !== "number") return;
      const delta = top - lastTop;
      lastTop = top;
      if (Math.abs(delta) < 4) return;
      setGlance(delta > 0 ? "right" : "left");
      clearTimeout(timer);
      timer = setTimeout(() => setGlance(null), 850);
    }
    // capture so we catch scroll on inner panels
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={orbRef}
      className={`mini-orb${variant === "light" ? " light" : ""}${
        blinking ? " blinking" : ""
      }`}
      data-glance={glance ?? undefined}
      aria-hidden="true"
    >
      <div className="mini-orb-halo" />
      <div className="mini-orb-core">
        <div className="orb-eyes">
          <div className="orb-eye" />
          <div className="orb-eye" />
        </div>
      </div>
      {thought && (
        <div key={thought.id} className="orb-thought show">
          {thought.text}
        </div>
      )}
    </div>
  );
}
