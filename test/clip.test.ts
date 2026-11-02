import { describe, expect, it } from "vitest";
import { clipText } from "@/lib/clip";

describe("clipText", () => {
  it("returns short text unchanged and normalizes whitespace", () => {
    expect(clipText("Short and sweet.", 600)).toBe("Short and sweet.");
    expect(clipText("  A  spaced\n out   line. ", 100)).toBe("A spaced out line.");
    expect(clipText(undefined, 100)).toBe("");
  });

  it("clips at the last complete sentence that fits", () => {
    const s = (c: string) => `${c.repeat(300)}.`;
    const t = `${s("a")} ${s("b")} ${s("c")}`;
    // 902 characters; only the second sentence end clears 60% of the 800 budget.
    expect(clipText(t, 800)).toBe(`${s("a")} ${s("b")}`);
  });

  it("keeps the latest fitting sentence end, including closing quotes", () => {
    const t = `A. ${"b".repeat(498)}.” ${"c".repeat(400)} extra words cut`;
    const out = clipText(t, 800);
    expect(out).toMatch(/.”$/);
    expect(out.length).toBeLessThanOrEqual(800);
  });

  it("falls back to a word boundary with an ellipsis when no sentence fits", () => {
    const t = "word ".repeat(240) + "tail";
    const out = clipText(t, 600);
    expect(out).toMatch(/word…$/);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.startsWith("word word")).toBe(true);
  });

  it("does not clip numbers with decimal points, preferring the word fallback", () => {
    const t = "Snow levels fall to 6300 ft and 1.7 inches of water are expected. " + "tail ".repeat(140);
    const out = clipText(t, 600);
    expect(out).toMatch(/…$/);
    expect(out).not.toMatch(/1…/);
    expect(out.startsWith("Snow levels fall to 6300 ft and 1.7 inches of water are expected.")).toBe(true);
  });
});
