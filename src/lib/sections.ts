/** Dashboard sections. Each is a page, routed from the navbar. */
export interface SectionDef {
  id: string;
  /** Full heading-style title (page title). */
  title: string;
  /** Short label for the navbar tabs. */
  label: string;
  /** Draw a faint divider before this tab in the navbar. */
  divider?: boolean;
}

export const SECTIONS: SectionDef[] = [
  { id: "regional", title: "Resort snowfall", label: "Snowfall" },
  { id: "daily-snow", title: "Daily Snow", label: "Daily Snow" },
  { id: "weather", title: "Mountain weather", label: "Weather" },
  { id: "plumes", title: "Ensemble plumes", label: "Plumes" },
  { id: "traffic", title: "Canyon roads", label: "Roads" },
  { id: "alta", title: "Alta", label: "Alta", divider: true },
  { id: "snowbird", title: "Snowbird", label: "Snowbird" },
  { id: "solitude", title: "Solitude", label: "Solitude" },
  { id: "brighton", title: "Brighton", label: "Brighton" },
];

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
