"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MiniOrb } from "./MiniOrb";
import { EventTimeline, type LifeEvent } from "./EventTimeline";

async function fetchEvents(): Promise<LifeEvent[]> {
  const d = await fetch("/api/events").then((r) => r.json());
  return d.events ?? [];
}

export function EventsView() {
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchEvents()
      .then((evs) => {
        setEvents(evs);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Poll while tab is visible — picks up events the Recorder extracted
  // after the user sent a chat message.
  useEffect(() => {
    function tick() {
      if (document.visibilityState !== "visible") return;
      fetchEvents().then(setEvents).catch(() => {});
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        fetchEvents().then(setEvents).catch(() => {});
      }
    }
    const timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <MiniOrb variant="light" />
      <div className="mx-auto max-w-3xl px-6 pt-12 pb-24">
        <div className="mb-10">
          <h1 className="text-[40px] font-semibold tracking-tight leading-tight">
            事件
          </h1>
          <p className="mt-2 text-[15px] text-secondary">
            ta 听到你说过的事，按发生时间排好。
          </p>
        </div>

        {loaded && events.length === 0 ? (
          <div className="mt-16 text-center text-[17px] text-secondary leading-relaxed">
            还没有事件。
            <br />
            先去
            <Link href="/" className="text-accent"> 记录 </Link>
            几件最近发生的事吧。
          </div>
        ) : (
          <EventTimeline events={events} bare />
        )}
      </div>
    </div>
  );
}
