"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { SECTIONS, sectionHref } from "@/lib/sections";

// useLayoutEffect warns during server rendering; measuring only happens in the browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Width of the resorts menu, kept in sync with `.section-nav__menu` in globals.css. */
const MENU_WIDTH = 200;
const MENU_MARGIN = 8;

interface Bar { left: number; width: number }

/** The current tab: a section link, or the resorts tab while on a resort page. */
function activeTab(tabs: HTMLElement | null): HTMLElement | null {
  return tabs?.querySelector<HTMLElement>(":scope > a[aria-current='page'], :scope > details > summary[data-current]") ?? null;
}

/**
 * Section tabs: one row that scrolls sideways on phones, with a blue bar
 * under the current tab that slides between tabs. The resorts share one tab whose
 * menu is fixed-positioned so the scrolling row can't clip it.
 */
export function SectionNav({ pathname }: { pathname: string | null }) {
  const tabs = useRef<HTMLDivElement>(null);
  const resortMenu = useRef<HTMLDetailsElement>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  const [animate, setAnimate] = useState(false);
  const [fade, setFade] = useState({ start: false, end: false });
  const [menuPos, setMenuPos] = useState<CSSProperties>();

  const resort = SECTIONS.find((s) => s.group && sectionHref(s.id) === pathname);

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

  const placeMenu = useCallback(() => {
    const summary = resortMenu.current?.querySelector("summary");
    if (!summary || !resortMenu.current?.open) return;
    const rect = summary.getBoundingClientRect();
    const maxLeft = window.innerWidth - MENU_WIDTH - MENU_MARGIN;
    setMenuPos({ top: rect.bottom + 4, left: Math.max(MENU_MARGIN, Math.min(rect.right - MENU_WIDTH, maxLeft)) });
  }, []);

  // Keep the open menu under its tab; close it on outside clicks and Escape.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (resortMenu.current && !resortMenu.current.contains(event.target as Node)) resortMenu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && resortMenu.current?.open) {
        resortMenu.current.open = false;
        resortMenu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", placeMenu, { passive: true });
    window.addEventListener("resize", placeMenu);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", placeMenu);
      window.removeEventListener("resize", placeMenu);
    };
  }, [placeMenu]);

  return (
    <div className="section-nav">
      <nav aria-label="Sections" className="section-nav__inner"
        data-fade-start={fade.start ? "" : undefined} data-fade-end={fade.end ? "" : undefined}>
        <div ref={tabs} className="section-nav__tabs" data-bar={bar ? "" : undefined} data-animate={animate ? "" : undefined}
          onScroll={() => { updateFade(); placeMenu(); }}>
          {SECTIONS.filter((s) => !s.group).map((s) => (
            <Link key={s.id} href={sectionHref(s.id)} aria-current={sectionHref(s.id) === pathname ? "page" : undefined}>{s.label}</Link>
          ))}
          <details ref={resortMenu} key={pathname} className="section-nav__resorts" onToggle={placeMenu}>
            <summary data-current={resort ? "" : undefined}>{resort?.label ?? "Resorts"} <span className="section-nav__chevron" aria-hidden="true" /></summary>
            <div className="section-nav__menu" style={menuPos}>{SECTIONS.filter((s) => s.group).map((s) => (
              <Link key={s.id} href={sectionHref(s.id)} aria-current={sectionHref(s.id) === pathname ? "page" : undefined}>{s.label}</Link>
            ))}</div>
          </details>
          <span className="section-nav__bar" aria-hidden="true"
            style={bar ? { transform: `translateX(${bar.left}px)`, width: bar.width } : undefined} />
        </div>
      </nav>
    </div>
  );
}
