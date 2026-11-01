"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { SECTIONS, sectionHref } from "@/lib/sections";
import { formatDenver } from "@/lib/time";

/** Sticky top navigation for browse mode. On phones the tabs scroll sideways. */
export function NavBar({
  activeIndex,
  generatedAt,
  now,
  onStartSlideshow,
}: {
  activeIndex: number;
  generatedAt: string | null;
  now: Date;
  onStartSlideshow: () => void;
}) {
  const tabsRef = useRef<HTMLUListElement>(null);

  // Keep the current tab visible in the scrolling strip.
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>("[aria-current='page']");
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeIndex]);

  return (
    <header className="nav">
      <div className="nav__bar">
        <Link href="/" className="nav__brand">
          Cottonwoods Snow Report
        </Link>
        <nav className="nav__tabs-wrap" aria-label="Sections">
          <ul className="nav__tabs" ref={tabsRef}>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <Link href={sectionHref(s.id)} className="nav__tab" aria-current={i === activeIndex ? "page" : undefined} title={s.title}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav__end">
          {generatedAt && <span className="nav__status">Data {formatDenver(generatedAt, now)}</span>}
          <button type="button" className="nav__slideshow" onClick={onStartSlideshow} title="Full-screen rotating slideshow, for a TV">
            ▶ Slideshow
          </button>
        </div>
      </div>
    </header>
  );
}
