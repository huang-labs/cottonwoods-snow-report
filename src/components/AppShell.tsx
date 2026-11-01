"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SECTIONS, sectionHref, sectionIndexFromPath } from "@/lib/sections";
import { DashboardContext, DataBanners, exitFullscreen, requestFullscreen, type DashboardData } from "./dashboard-context";
import { loadPrefs, savePrefs, useNow, useReport, type Prefs } from "./hooks";
import { NavBar } from "./NavBar";
import { Slideshow } from "./Slideshow";

interface SlideshowStart {
  index: number;
  playing: boolean;
}

/**
 * App frame: browse mode (navbar + the routed section page) by default, or a
 * full-screen slideshow for TVs. URL options: `?kiosk=1` opens straight into
 * the slideshow at the current page (`&paused=1` starts paused). The legacy
 * `?slide=<id>` redirects to that section's page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { report, loadedAt, error } = useReport(60_000);
  const now = useNow(30_000);
  const pathname = usePathname();
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [slideshow, setSlideshow] = useState<SlideshowStart | null>(null);

  // Preferences and URL options are browser-only, so read them after mount.
  useEffect(() => {
    setPrefs(loadPrefs(window.localStorage));
    const params = new URLSearchParams(window.location.search);
    const legacy = SECTIONS.findIndex((s) => s.id === params.get("slide"));
    const index = legacy >= 0 ? legacy : Math.max(0, sectionIndexFromPath(window.location.pathname));
    if (params.get("kiosk") === "1") {
      setSlideshow({ index, playing: params.get("paused") !== "1" });
    } else if (legacy >= 0) {
      router.replace(sectionHref(SECTIONS[legacy].id));
    }
    // Mount-only: later navigation never re-enters kiosk mode.
  }, []);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...(p ?? loadPrefs(undefined)), ...patch };
      savePrefs(window.localStorage, next);
      return next;
    });
  }, []);

  // Called from a click, so the fullscreen request counts as a user gesture.
  const startSlideshow = useCallback(() => {
    requestFullscreen();
    setSlideshow({ index: Math.max(0, sectionIndexFromPath(pathname)), playing: true });
  }, [pathname]);

  // Leave the slideshow on the page of the slide that was showing.
  const exitSlideshow = useCallback(
    (index: number) => {
      exitFullscreen();
      setSlideshow(null);
      router.replace(sectionHref(SECTIONS[index].id));
    },
    [router],
  );

  const data: DashboardData = { report, loadedAt, error, now };

  return (
    <DashboardContext.Provider value={data}>
      {slideshow ? (
        <Slideshow
          initialIndex={slideshow.index}
          initialPlaying={slideshow.playing}
          durationSec={prefs?.durationSec ?? 20}
          onDurationChange={(durationSec) => updatePrefs({ durationSec })}
          onExit={exitSlideshow}
        />
      ) : (
        <div className="app app--browse">
          <NavBar activeIndex={sectionIndexFromPath(pathname)} generatedAt={report?.generatedAt ?? null} now={now} onStartSlideshow={startSlideshow} />
          <DataBanners data={data} overlay={false} />
          <main className="page">{children}</main>
        </div>
      )}
    </DashboardContext.Provider>
  );
}
