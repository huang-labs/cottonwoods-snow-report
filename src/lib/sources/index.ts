import type { SourceId } from "../types";
import { altaSource } from "./alta";
import { brightonSource } from "./brighton";
import { nwsSource } from "./nws";
import { plumesSource } from "./plumes";
import { resortCamsSource } from "./resortcams";
import { roadsSource } from "./roads";
import { snowbirdSource } from "./snowbird";
import { solitudeSource } from "./solitude";
import { travelTimesSource, webcamsSource } from "./traffic";
import type { SourceDefinition } from "./types";

export const SOURCES: SourceDefinition[] = [
  altaSource,
  snowbirdSource,
  solitudeSource,
  brightonSource,
  plumesSource,
  nwsSource,
  roadsSource,
  travelTimesSource,
  webcamsSource,
  resortCamsSource,
] as SourceDefinition[];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<SourceId, SourceDefinition>;
