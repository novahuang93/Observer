"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavBar() {
  const pathname = usePathname() ?? "/";
  const isEvents = pathname.startsWith("/events");
  const isFeed = pathname.startsWith("/feed");
  const isChat = !isEvents && !isFeed;

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/72 border-b border-separator-soft">
      <div className="mx-auto max-w-3xl px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[0.04em] text-foreground"
        >
          <BrandOrb />
          观察·Observer
        </Link>
        <nav className="flex items-center gap-1 text-[13px]">
          <Tab href="/" active={isChat}>
            记录
          </Tab>
          <Tab href="/events" active={isEvents}>
            事件
          </Tab>
          <Tab href="/feed" active={isFeed}>
            观察
          </Tab>
        </nav>
      </div>
    </header>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full transition-colors ${
        active
          ? "text-foreground bg-black/[0.06]"
          : "text-secondary hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * Tiny logo orb in the navbar — same character as the floating MiniOrb,
 * just shrunk to fit alongside the brand text. Static (no animation).
 */
function BrandOrb() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-[22px] w-[22px] items-center justify-center gap-[3px] rounded-full"
      style={{
        background:
          "radial-gradient(circle at 32% 26%, rgba(90,90,96,0.55) 0%, rgba(90,90,96,0) 30%), radial-gradient(circle at 60% 65%, #1a1a1c 0%, #08080a 95%)",
        boxShadow:
          "0 3px 8px -2px rgba(0,0,0,0.32), inset 0 -2px 4px -1px rgba(0,0,0,0.55)",
      }}
    >
      <span className="block h-[3px] w-[3px] rounded-full bg-[#f5f5f7]" />
      <span className="block h-[3px] w-[3px] rounded-full bg-[#f5f5f7]" />
    </span>
  );
}
