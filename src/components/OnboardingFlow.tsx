"use client";

import { useEffect, useRef, useState, ViewTransition } from "react";
import { useRouter } from "next/navigation";

type Phase = "greet" | "questions" | "submitting" | "done";

const PROMPTS = [
  "最近最累的一件事？",
  "最近最让你舒服的一件事？",
  "最近一直在想，但没说出口的事？",
];

const FALLBACK_NAME = "你";

export function OnboardingFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("greet");
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the right field after a phase transition
  useEffect(() => {
    if (phase === "greet") {
      const t = setTimeout(() => nameInputRef.current?.focus(), 600);
      return () => clearTimeout(t);
    }
    if (phase === "questions") {
      const t = setTimeout(() => answerRef.current?.focus(), 500);
      return () => clearTimeout(t);
    }
  }, [phase]);

  function goToQuestions() {
    setPhase("questions");
  }

  async function skip() {
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: true }),
      });
    } catch {
      /* swallow — user just wanted out, send them to chat anyway */
    }
    router.replace("/");
    router.refresh();
  }

  async function submit() {
    setError(null);
    setPhase("submitting");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          answers: [answer.trim()],
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPhase("done");
      // Tiny pause so the "done" frame is visible, then jump to feed.
      setTimeout(() => {
        router.replace("/feed?from=onboarding");
      }, 700);
    } catch (err) {
      console.error(err);
      setError("出了点小问题，先去聊聊吧。");
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, 1200);
    }
  }

  const canSubmit = answer.trim().length > 0 && phase === "questions";
  const greetingDisplayName = name.trim() || FALLBACK_NAME;

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center px-6 pb-12 pt-12 overflow-y-auto">
      {/* PHASE 1: greet + name */}
      {phase === "greet" && (
        <GreetPhase
          name={name}
          onNameChange={setName}
          onNext={goToQuestions}
          onSkip={skip}
          nameInputRef={nameInputRef}
        />
      )}

      {/* PHASE 2: single open question (placeholder rotates the 3 angles) */}
      {phase === "questions" && (
        <QuestionsPhase
          name={greetingDisplayName}
          answer={answer}
          onAnswerChange={setAnswer}
          canSubmit={canSubmit}
          onSubmit={submit}
          onSkip={skip}
          answerRef={answerRef}
        />
      )}

      {/* PHASE 3: loading while observer runs */}
      {phase === "submitting" && (
        <SubmittingPhase name={greetingDisplayName} />
      )}

      {/* PHASE 4: brief confirmation before redirect */}
      {phase === "done" && <DonePhase />}

      {error && (
        <p className="mt-4 text-[13px] text-red-600/90">{error}</p>
      )}
    </div>
  );
}

function GreetPhase({
  name,
  onNameChange,
  onNext,
  onSkip,
  nameInputRef,
}: {
  name: string;
  onNameChange: (v: string) => void;
  onNext: () => void;
  onSkip: () => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onNext();
    }
  }
  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-md">
      <WelcomeOrb entryClass="welcome-in-1" />
      <p className="welcome-in-2 mt-14 text-center text-[17px] leading-[1.85] text-foreground">
        嗨，我们刚认识。
        {"\n"}
        我会在这儿安静地陪你记录日常，
        {"\n"}
        然后偶尔从远处，写下我注意到的事。
        {"\n\n"}
        先问一下，我怎么称呼你？
      </p>
      <div className="welcome-in-3 mt-10 w-full">
        <div className="flex items-end gap-2 p-2 pl-4 bg-white border border-separator rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-12px_rgba(0,0,0,0.16)]">
          <input
            ref={nameInputRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="怎么称呼你？"
            maxLength={40}
            className="flex-1 outline-none bg-transparent text-[15px] leading-6 py-2 placeholder:text-tertiary"
          />
          <button
            onClick={onNext}
            className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-foreground text-white transition-transform hover:scale-[1.03] active:scale-95"
            aria-label="继续"
          >
            <ArrowRight />
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-tertiary">
          不填也可以 ·{" "}
          <button
            onClick={onSkip}
            className="underline-offset-2 hover:underline"
          >
            先看看 demo
          </button>
        </p>
      </div>
    </div>
  );
}

function QuestionsPhase({
  name,
  answer,
  onAnswerChange,
  canSubmit,
  onSubmit,
  onSkip,
  answerRef,
}: {
  name: string;
  answer: string;
  onAnswerChange: (v: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  onSkip: () => void;
  answerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const displayName = name === FALLBACK_NAME ? "" : name;

  // Rotate the placeholder through the 3 angles, but only while the
  // user hasn't typed anything — once they're writing, freezing the
  // hint avoids it changing under their thumb.
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const isEmpty = answer.length === 0;
  useEffect(() => {
    if (!isEmpty) return;
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PROMPTS.length);
    }, 3500);
    return () => clearInterval(t);
  }, [isEmpty]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  }

  return (
    <div className="welcome-in-1 flex flex-col items-center justify-center flex-1 w-full max-w-md">
      <WelcomeOrb />

      <p className="welcome-in-2 mt-14 text-center text-[17px] leading-[1.85] text-foreground">
        {displayName ? `好，${displayName}。` : "好。"}
        {"\n"}
        跟我说件最近发生的事——
        {"\n"}
        我想试着写写看。
      </p>

      <div className="welcome-in-3 mt-10 w-full">
        <div className="relative flex items-end gap-2 p-2 pl-4 bg-white border border-separator rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-12px_rgba(0,0,0,0.16)]">
          <div className="relative flex-1">
            <textarea
              ref={answerRef}
              value={answer}
              onChange={(e) => onAnswerChange(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={400}
              className="w-full resize-none outline-none bg-transparent text-[15px] leading-6 py-2 placeholder:text-tertiary"
              placeholder=""
            />
            {isEmpty && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 right-0 py-2 text-[15px] leading-6 text-tertiary"
              >
                <span
                  key={placeholderIdx}
                  className="placeholder-rotate inline-block"
                >
                  {PROMPTS[placeholderIdx]}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-foreground text-white transition-all duration-150 hover:scale-[1.03] active:scale-95 disabled:bg-black/[0.08] disabled:text-tertiary disabled:hover:scale-100"
            aria-label="让 ta 想一下"
          >
            <ArrowRight />
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-tertiary">
          Enter 发送 ·{" "}
          <button
            onClick={onSkip}
            className="underline-offset-2 hover:underline"
          >
            先看看 demo
          </button>
        </p>
      </div>
    </div>
  );
}

// Soft narration during the observer's run. The Observer is one
// non-streaming LLM call (~3–10s) so we have nothing real to report —
// instead the lines mirror what ta would plausibly be doing, paced
// slow enough to feel quiet rather than chatty. Last line holds
// indefinitely so a slow run still feels like the orb is mid-thought,
// not stuck on a loop.
const THINKING_LINES = [
  "ta 在读你刚说的…",
  "回头翻了翻最近的事…",
  "想该怎么写下来…",
  "差不多了…",
];
const LINE_INTERVAL_MS = 3000;

function SubmittingPhase({ name }: { name: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => Math.min(i + 1, THINKING_LINES.length - 1));
    }, LINE_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  const prefix =
    idx === 0 && name !== FALLBACK_NAME ? `${name}，` : "";

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-md">
      <WelcomeOrb />
      <p
        className="mt-12 text-center text-[16px] leading-[1.7] text-secondary"
        aria-live="polite"
      >
        <span key={idx} className="placeholder-rotate inline-block">
          {prefix}
          {THINKING_LINES[idx]}
        </span>
      </p>
    </div>
  );
}

function DonePhase() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-md">
      {/* Same view-transition name as <MiniOrb /> on /feed — when the
          router navigates from here, the browser morphs this 88px center
          orb into the 40px top-left mini-orb. */}
      <ViewTransition name="observer-orb">
        <WelcomeOrb />
      </ViewTransition>
      <p className="mt-12 text-center text-[16px] leading-[1.7] text-secondary">
        想好了，给你看看。
      </p>
    </div>
  );
}

// 88px sphere with halos + eyes — the welcome-page version of the
// Observer's character. Eyes use the shared .orb-eye class so the
// mini-orb's blink animation applies here too; sizes are bumped up
// in globals.css via the `.orb .orb-eye` rule.
function WelcomeOrb({ entryClass }: { entryClass?: string }) {
  return (
    <div className={`orb${entryClass ? ` ${entryClass}` : ""}`} aria-hidden="true">
      <div className="orb-halo-wide" />
      <div className="orb-halo" />
      <div className="orb-core">
        <div className="orb-eyes">
          <div className="orb-eye" />
          <div className="orb-eye" />
        </div>
      </div>
    </div>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8h10M13 8l-4.5-4.5M13 8l-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
