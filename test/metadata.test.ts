import { describe, expect, it } from "vitest";
import { sectionMetadata, SITE_TITLE } from "@/lib/metadata";
import { SECTIONS, sectionHref } from "@/lib/sections";

describe("section share metadata", () => {
  it.each(SECTIONS.slice(1))("matches the document title and URL for $id", (section) => {
    const metadata = sectionMetadata(section);
    const title = `${metadata.title} · ${SITE_TITLE}`;
    expect(metadata.openGraph).toMatchObject({ title, url: sectionHref(section.id), siteName: SITE_TITLE });
    expect(metadata.twitter).toMatchObject({ title, card: "summary_large_image" });
    const url = section.id === "daily-snow" ? "/daily-snow/opengraph-image" : "/opengraph-image";
    expect(metadata.openGraph).toHaveProperty("images", [expect.objectContaining({ url })]);
    expect(metadata.twitter).toHaveProperty("images", [expect.objectContaining({ url })]);
  });

  it("describes the daily forecast on Daily Snow", () => {
    const metadata = sectionMetadata(SECTIONS.find((s) => s.id === "daily-snow")!);
    expect(metadata.description).toContain("daily snow forecast");
    expect(metadata.openGraph).toHaveProperty("description", metadata.description);
    expect(metadata.twitter).toHaveProperty("description", metadata.description);
  });
});
