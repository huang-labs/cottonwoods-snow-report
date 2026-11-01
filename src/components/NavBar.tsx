"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { GROUP_LABELS, SECTIONS, sectionHref, type SectionDef } from "@/lib/sections";
import { formatDenver } from "@/lib/time";

interface GroupMember {
  section: SectionDef;
  index: number;
}

/**
 * A navbar tab that opens a dropdown of section links (disclosure pattern).
 * The panel is position: fixed so the sideways-scrolling tab strip can't clip it.
 */
function NavGroup({ label, members, activeIndex }: { label: string; members: GroupMember[]; activeIndex: number }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;
  const rootRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const focusOnOpen = useRef<number | null>(null);
  const panelId = useId();
  const active = members.find((m) => m.index === activeIndex)?.section;

  const openPanel = (focusPos: number | null) => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    focusOnOpen.current = focusPos;
    setPos({ top: r.bottom + 6, left: r.left });
  };
  const close = (refocus = false) => {
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open && focusOnOpen.current !== null) linkRefs.current[focusOnOpen.current]?.focus();
  }, [open]);

  // Close on click/tap outside, and when the layout moves under the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPos(null);
    };
    const onMove = (e: Event) => {
      // Scrolling inside the panel itself is fine; anything else detaches it.
      if (!rootRef.current?.contains(e.target as Node)) setPos(null);
    };
    const onResize = () => setPos(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const currentPos = Math.max(0, members.findIndex((m) => m.index === activeIndex));

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      openPanel(e.key === "ArrowDown" ? currentPos : members.length - 1);
      e.preventDefault();
    } else if (e.key === "Escape" && open) {
      close();
    }
  };

  const onPanelKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const links = linkRefs.current.filter((el): el is HTMLAnchorElement => el !== null);
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const focus = (j: number) => {
      links[(j + links.length) % links.length]?.focus();
      e.preventDefault();
    };
    if (e.key === "ArrowDown") focus(i + 1);
    else if (e.key === "ArrowUp") focus(i - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(links.length - 1);
    else if (e.key === "Escape") {
      close(true);
      e.preventDefault();
    }
  };

  return (
    <li
      ref={rootRef}
      className="nav__group"
      onBlur={(e) => {
        // Tabbing out of the trigger + panel closes it.
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setPos(null);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`nav__tab nav__group-trigger ${active ? "is-active" : ""}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : openPanel(null))}
        onKeyDown={onTriggerKey}
        title={active ? `${label}: ${active.title}` : label}
      >
        {active ? (
          <>
            {label} <span className="nav__group-sep">·</span> {active.label}
          </>
        ) : (
          label
        )}
        <span className="nav__caret" aria-hidden="true">▾</span>
      </button>
      {pos && (
        <ul id={panelId} className="nav__menu" style={{ top: pos.top, left: pos.left }} onKeyDown={onPanelKey}>
          {members.map((m, i) => (
            <li key={m.section.id}>
              <Link
                ref={(el) => {
                  linkRefs.current[i] = el;
                }}
                href={sectionHref(m.section.id)}
                className="nav__menu-item"
                aria-current={m.index === activeIndex ? "page" : undefined}
                onClick={() => close()}
              >
                {m.section.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

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
    const el = tabsRef.current?.querySelector<HTMLElement>("[aria-current='page'], .is-active");
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
            {SECTIONS.map((s, i) => {
              if (s.group) {
                // Render each group once, where its first member sits.
                if (SECTIONS[i - 1]?.group === s.group) return null;
                const members = SECTIONS.flatMap((m, j) => (m.group === s.group ? [{ section: m, index: j }] : []));
                // Re-mount on navigation so the panel closes on any route change.
                return <NavGroup key={`${s.group}-${activeIndex}`} label={GROUP_LABELS[s.group]} members={members} activeIndex={activeIndex} />;
              }
              return (
                <li key={s.id}>
                  <Link href={sectionHref(s.id)} className="nav__tab" aria-current={i === activeIndex ? "page" : undefined} title={s.title}>
                    {s.label}
                  </Link>
                </li>
              );
            })}
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
