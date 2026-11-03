import { describe, expect, it } from "vitest";
import { emptyDailySnowState } from "@/lib/dailysnow";
import { dailySnowPublicationStatus } from "@/lib/dailysnow/publication";
import { IN_FLIGHT_MS } from "@/lib/dailysnow/schedule";
import { denverToUtc } from "@/lib/time";
import type { DailySnowState } from "@/lib/types";

const now = (hour: number, minute = 0) => denverToUtc(2026, 11, 3, hour, minute);
const status = (at: Date, state?: DailySnowState, expected = true, date = "2026-11-02") => dailySnowPublicationStatus(date, state, at, expected);
const failed = (): DailySnowState => ({
  ...emptyDailySnowState(),
  attempts: { date: "2026-11-03", count: 3, calls: 6 },
  lastAttemptAt: now(6, 30).toISOString(), lastFinishedAt: now(6, 31).toISOString(),
  lastError: "Model timeout", consecutiveFailures: 3,
});

describe("Daily Snow publication availability", () => {
  it("keeps yesterday's edition scheduled at midnight, then pending during the publication window", () => {
    expect(status(now(0))).toBe("scheduled");
    expect(status(now(5, 59))).toBe("scheduled");
    expect(status(now(6))).toBe("pending");
    expect(status(now(9, 59))).toBe("pending");
    expect(status(now(10))).toBe("delayed");
  });

  it("reports today's completed edition even when a manual rewrite failed", () => {
    expect(status(now(12), failed(), true, "2026-11-03")).toBe("current");
  });

  it("marks exhausted retries or the daily request cap delayed without waiting for 10 AM", () => {
    expect(status(now(6, 32), failed())).toBe("delayed");
    const capped = { ...failed(), attempts: { date: "2026-11-03", count: 1, calls: 12 } };
    expect(status(now(6, 32), capped)).toBe("delayed");
  });

  it("allows the final in-flight attempt to finish after the cutoff", () => {
    const state = { ...failed(), lastAttemptAt: now(9, 59).toISOString(), lastFinishedAt: now(6, 31).toISOString() };
    expect(status(now(10), state)).toBe("pending");
    expect(status(new Date(now(9, 59).getTime() + IN_FLIGHT_MS), state)).toBe("delayed");
  });

  it("does not turn yesterday's failed attempts into today's exhausted retries", () => {
    const state = { ...failed(), attempts: { date: "2026-11-02", count: 3, calls: 12 } };
    expect(status(now(6, 32), state)).toBe("pending");
    expect(status(now(0), state)).toBe("scheduled");
  });

  it("keeps a missed earlier edition visible as a delay overnight", () => {
    expect(status(now(0), undefined, true, "2026-11-01")).toBe("delayed");
  });

  it("does not warn when publication is intentionally paused for lack of season/snow activity", () => {
    expect(status(now(12), failed(), false)).toBe("paused");
    expect(status(now(0), undefined, false, "2026-09-01")).toBe("paused");
  });

  it.each([
    [2026, 3, 8, "2026-03-07"],
    [2026, 11, 1, "2026-10-31"],
  ])("uses Denver calendar dates and publication hours across DST (%i-%i-%i)", (year, month, day, yesterday) => {
    expect(dailySnowPublicationStatus(yesterday, undefined, denverToUtc(year, month, day, 0), true)).toBe("scheduled");
    expect(dailySnowPublicationStatus(yesterday, undefined, denverToUtc(year, month, day, 6), true)).toBe("pending");
    expect(dailySnowPublicationStatus(yesterday, undefined, denverToUtc(year, month, day, 10), true)).toBe("delayed");
  });
});
