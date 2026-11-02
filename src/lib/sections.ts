/** Dashboard sections. Each is a page in browse mode and a slide in slideshow mode. */
export interface SectionDef {
  id: string;
  /** Full heading-style title (slideshow picker, page title). */
  title: string;
  /** Short label for the navbar tabs. */
  label: string;
  /** Sections sharing a group collapse into one dropdown in the navbar. */
  group?: SectionGroup;
  /** Browse-mode page only; the slideshow skips it. */
  slideshow?: false;
}

export type SectionGroup = "resorts";
export const GROUP_LABELS: Record<SectionGroup, string> = { resorts: "Resorts" };

export const SECTIONS: SectionDef[] = [
  { id: "regional", title: "Regional snowfall", label: "Snowfall" },
  { id: "daily-snow", title: "Daily Snow", label: "Daily Snow", slideshow: false },
  { id: "weather", title: "Mountain weather", label: "Weather" },
  { id: "plumes", title: "Ensemble plumes", label: "Plumes" },
  { id: "traffic", title: "Canyon roads", label: "Roads" },
  { id: "alta", title: "Alta", label: "Alta", group: "resorts" },
  { id: "snowbird", title: "Snowbird", label: "Snowbird", group: "resorts" },
  { id: "solitude", title: "Solitude", label: "Solitude", group: "resorts" },
  { id: "brighton", title: "Brighton", label: "Brighton", group: "resorts" },
];

/** Index of the next section shown in the slideshow from `i`, stepping by `dir` (wraps around). */
export function slideshowStep(i: number, dir: 1 | -1): number {
  let j = i;
  for (let n = 0; n < SECTIONS.length; n++) {
    j = (j + dir + SECTIONS.length) % SECTIONS.length;
    if (SECTIONS[j].slideshow !== false) return j;
  }
  return i;
}

/** The first section lives at `/`; the others at `/<id>`. */
export function sectionHref(id: string): string {
  return id === SECTIONS[0].id ? "/" : `/${id}`;
}

/** Index of the section a pathname shows (0 for `/`), or -1 for other paths. */
export function sectionIndexFromPath(pathname: string | null): number {
  const id = (pathname ?? "/").replace(/^\/+|\/+$/g, "");
  if (id === "") return 0;
  return SECTIONS.findIndex((s) => s.id === id);
}

export function findSection(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}
