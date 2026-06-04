"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavBar() {
  const pathname = usePathname();
  const isFeed = pathname?.startsWith("/feed");
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/72 border-b border-separator-soft">
      <div className="mx-auto max-w-3xl px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-[0.04em] text-foreground"
        >
          观察·Observer
        </Link>
        <nav className="flex items-center gap-1 text-[13px]">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-full transition-colors ${
              !isFeed
                ? "text-foreground bg-black/[0.06]"
                : "text-secondary hover:text-foreground"
            }`}
          >
            记录
          </Link>
          <Link
            href="/feed"
            className={`px-3 py-1.5 rounded-full transition-colors ${
              isFeed
                ? "text-foreground bg-black/[0.06]"
                : "text-secondary hover:text-foreground"
            }`}
          >
            观察
          </Link>
        </nav>
      </div>
    </header>
  );
}
