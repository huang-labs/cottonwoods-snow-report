"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { SECTIONS, sectionHref } from "@/lib/sections";

// useLayoutEffect warns during server rendering; measuring only happens in the browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface Bar { left: number; width: number }

function activeTab(tabs: HTMLElement | null): HTMLElement | null {
  return tabs?.querySelector<HTMLElement>(":scope > a[aria-current='page']") ?? null;
}

/**
 * Section tabs: one row of every section (resorts included) that scrolls
 * sideways on phones, with a blue bar under the current tab that slides between tabs.
 */
export function SectionNav({ pathname }: { pathname: string | null }) {
  const tabs = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  const [animate, setAnimate] = useState(false);
  const [fade, setFade] = useState({ start: false, end: false });

  const updateFade = useCallback(() => {
    const el = tabs.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.start === start && f.end === end ? f : { start, end }));
  }, []);

  const measure = useCallback(() => {
    const active = activeTab(tabs.current);
    setBar(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    updateFade();
  }, [updateFade]);

  // Place the bar under the current tab and scroll that tab into view.
  useBrowserLayoutEffect(() => {
    measure();
    const el = tabs.current;
    const active = activeTab(el);
    if (!el || !active) return;
    const { offsetLeft: left, offsetWidth: width } = active;
    if (left < el.scrollLeft || left + width > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = left - (el.clientWidth - width) / 2;
    }
  }, [pathname, measure]);

  // Turn on the slide only after the first placement, so the bar doesn't fly in on load.
  useEffect(() => {
    if (!bar || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [bar, animate]);

  // Re-measure when tab widths change (web fonts loading, viewport resizes).
  useEffect(() => {
    const el = tabs.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="section-nav">
      <nav aria-label="Sections" className="section-nav__inner"
        data-fade-start={fade.start ? "" : undefined} data-fade-end={fade.end ? "" : undefined}>
        <div ref={tabs} className="section-nav__tabs" data-bar={bar ? "" : undefined} data-animate={animate ? "" : undefined}
          onScroll={updateFade}>
          {SECTIONS.map((s) => (
            <Link key={s.id} href={sectionHref(s.id)} aria-current={sectionHref(s.id) === pathname ? "page" : undefined}>{s.label}</Link>
          ))}
          <span className="section-nav__bar" aria-hidden="true"
            style={bar ? { transform: `translateX(${bar.left}px)`, width: bar.width } : undefined} />
        </div>
      </nav>
    </div>
  );
}
