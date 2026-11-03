import type { StormRecord, StormTrackingState } from "./dailysnow/storm-types";

/**
 * Normalized report contract shared by the collector (scheduled Worker), the
 * API route, and the client app shell.
 *
 * Every value carries its own provenance. Three states are kept distinct:
 *  - "reported":      the source supplied a value (which may legitimately be 0)
 *  - "not_reported":  the source has the field but left it empty ("--", null)
 *  - "unavailable":   the source does not provide this measurement at all
 */

export type MetricUnit = "in" | "°F" | "mph" | "ft" | "%" | "count";

export type Metric =
  | {
      state: "reported";
      value: number;
      unit: MetricUnit;
      /** Source's own label for the measurement window, e.g. "Snow 24 Hrs." */
      label: string;
      /** Extra provenance, e.g. "rolling window computed by Snowbird at fetch time" */
      note?: string;
    }
  | { state: "not_reported"; label: string; note?: string }
  | { state: "unavailable"; label: string; note?: string };

export type SourceCategory =
  | "resort"
  | "plume"
  | "weather"
  | "roads"
  | "travel-times"
  | "webcams";

export type CollectionStatus = "ok" | "error" | "never";

/** Persisted (KV) per-source record. */
export interface SourceRecord<P = unknown> {
  id: SourceId;
  /** Last collection attempt (success or failure), ISO UTC. */
  lastAttemptAt: string | null;
  /** Last attempt that retrieved AND validated a payload, ISO UTC. */
  lastSuccessfulFetchAt: string | null;
  /** Upstream publication/observation time of the stored payload, if supplied. */
  sourceUpdatedAt: string | null;
  status: CollectionStatus;
  /** Most recent failure message (kept until the next success). */
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  /** Server-side diagnostics for the last attempt (timings, upstream HTTP status). */
  diagnostics: {
    durationMs: number;
    upstream: Array<{ url: string; status: number | null; ms: number }>;
  } | null;
  /** Last successful normalized payload. Preserved across failures. */
  payload: P | null;
}

export interface Snapshot {
  schemaVersion: 1;
  /** Time the collector last wrote the snapshot, ISO UTC. */
  writtenAt: string;
  sources: Partial<Record<SourceId, SourceRecord>>;
  /** AI resort pick and its scheduling state. Absent until the AI binding is configured. */
  recommendation?: RecommendationState;
  /** AI Daily Snow post and its scheduling state. Absent until the AI binding is configured. */
  dailySnow?: DailySnowState;
  /** Observation-based storm memory, updated by collection even without AI. */
  stormTracking?: StormTrackingState;
}

export type SourceId =
  | "alta"
  | "snowbird"
  | "solitude"
  | "brighton"
  | "plumes"
  | "nws"
  | "roads"
  | "traveltimes"
  | "webcams"
  | "resortcams"
  | "nwsafd"
  | "ensemble";

// ---------- Resort payloads ----------

export type LiftStatus = "open" | "closed" | "hold" | "scheduled" | "unknown";

export interface Lift {
  name: string;
  status: LiftStatus;
  /** Status text exactly as the source gave it. */
  rawStatus: string;
  hours?: string | null;
  note?: string | null;
}

export interface NamedTerrain {
  name: string;
  /** "gate", "area", "terrain" — what the source calls it. */
  kind: string;
  status: LiftStatus;
  rawStatus: string;
  note?: string | null;
}

export interface Notice {
  title: string;
  text: string;
  /** "critical" notices sort first. */
  severity: "info" | "warning" | "critical";
  updatedAt?: string | null;
}

export interface WeatherObservation {
  location: string;
  observedAt: string | null;
  temperature: Metric;
  wind: Metric;
  gust: Metric;
  direction: string | null;
  sky?: string | null;
}

export interface SnowfallSet {
  overnight: Metric;
  h12: Metric;
  h24: Metric;
  h48: Metric;
  h72: Metric;
  d7: Metric;
  storm: Metric;
  season: Metric;
}

export interface ResortReport {
  resort: string;
  sourceName: string;
  sourceUrl: string;
  /** What the report time represents, in the source's terms. */
  reportTimeLabel: string;
  reportTime: string | null;
  operatingStatus: string | null;
  snowfall: SnowfallSet;
  base: Metric;
  observations: WeatherObservation[];
  liftsOpen: number | null;
  liftsTotal: number | null;
  lifts: Lift[] | null;
  terrain: NamedTerrain[] | null;
  notices: Notice[];
  parking: Array<{ name: string; status: string; note?: string | null }>;
  /** Free-text report (plain text, HTML stripped). */
  narrative: string | null;
  /** Optional sub-feeds that failed during an otherwise successful collection. */
  missingSections?: string[];
}

// ---------- Plumes ----------

export interface PlumePanel {
  id: "snow" | "slr";
  title: string;
  /** Same-origin URL of the cropped PNG (served from KV by /api/plume/…). */
  url: string;
  width: number;
  height: number;
  /**
   * Axes frame inside the crop (pixels). The frame's left edge is the model
   * initialization time and its right edge init + forecastHours, so the
   * client can draw a Mountain Time axis in place of the original UTC labels.
   */
  plot: { left: number; right: number; top: number; bottom: number };
}

export interface PlumeChart {
  stationCode: string;
  stationName: string;
  /** Full original chart (fallback when cropping fails). */
  imageUrl: string;
  pageUrl: string;
  imageLastModified: string | null;
  runCode: string;
  initTime: string;
  /** Forecast length covered by the time axis (from the image name, e.g. F240). */
  forecastHours: number;
  /** Accumulated snow + SLR panels; null when cropping failed (see cropError). */
  panels: PlumePanel[] | null;
  cropError: string | null;
}

export interface PlumePayload {
  product: string;
  runCode: string;
  initTime: string;
  charts: PlumeChart[];
}

// ---------- NWS mountain weather ----------

export interface ForecastBlock {
  start: string;
  end: string;
  /** "Day"/"Night" label in America/Denver, e.g. "Sat 6 AM–6 PM". */
  label: string;
  snowIn: number | null;
  qpfIn: number | null;
  snowLevelMinFt: number | null;
  snowLevelMaxFt: number | null;
  tempMinF: number | null;
  tempMaxF: number | null;
  windMaxMph: number | null;
  gustMaxMph: number | null;
  popMax: number | null;
}

export interface SixHourSnow {
  start: string;
  snowIn: number;
  snowLevelFt: number | null;
}

export interface NextStorm {
  start: string;
  end: string;
  totalSnowIn: number;
  minSnowLevelFt: number | null;
}

export interface PointForecast {
  name: string;
  gridId: string;
  gridX: number;
  gridY: number;
  elevationFt: number | null;
  gridUpdatedAt: string | null;
  blocks: ForecastBlock[];
  sixHourSnow: SixHourSnow[];
  /** Unrounded hourly NWS accumulation; absent on snapshots collected before phase 1. */
  hourlySnow?: Array<{ start: string; snowIn: number }>;
  nextStorm: NextStorm | null;
  periods: Array<{ name: string; detailedForecast: string; start: string }>;
}

export interface NwsPayload {
  points: PointForecast[];
}

// ---------- Roads / traffic ----------

export interface RoadNotice extends Notice {
  canyon: "LCC" | "BCC" | "both" | "other";
  source: string;
}

export interface RoadsPayload {
  notices: RoadNotice[];
  signs: Array<{ name: string; roadway: string; direction: string | null; messages: string[]; source: string }>;
  /** Which sub-feeds contributed, for attribution. */
  contributors: string[];
  /** Sub-feeds that failed during the last (otherwise successful) roads collection. */
  partialFailures: string[];
}

export interface TravelSegment {
  canyon: "LCC" | "BCC";
  name: string;
  from: string;
  to: string;
  direction: "Up" | "Down" | string;
  currentMin: number | null;
  freeFlowMin: number | null;
  distanceMi: number | null;
  measuredAt: string | null;
}

export interface TravelTimesPayload {
  segments: TravelSegment[];
  /** Newest per-segment measurement time. */
  newestMeasurementAt: string | null;
  layerEditedAt: string | null;
}

export interface Webcam {
  id: string;
  canyon: "LCC" | "BCC";
  title: string;
  description: string;
  imageUrl: string;
  available: boolean;
}

export interface WebcamsPayload {
  cameras: Webcam[];
}

export type PrimaryResortId = "alta" | "snowbird" | "solitude" | "brighton";

/** A resort-operated camera shown on that resort's page. */
export type ResortCam = {
  resort: PrimaryResortId;
  /** Camera name as the resort publishes it. */
  title: string;
  /** Resort page the camera was discovered on. */
  pageUrl: string;
} & (
  | {
      kind: "image";
      imageUrl: string;
      /** Image Last-Modified at the last check; null when not published or implausible. */
      capturedAt: string | null;
    }
  | {
      /** Live stream; the embedded YouTube player shows its own live/offline state. */
      kind: "youtube";
      videoId: string;
    }
);

export interface ResortCamsPayload {
  cameras: ResortCam[];
  /** Per-resort discovery failures (other resorts' cameras are unaffected). */
  failures: string[];
  /** YouTube video id → stream title (oEmbed), cached so unchanged pages cost no lookups. */
  streamTitles: Record<string, string>;
}

// ---------- AI recommendation ----------

export type CanyonId = "LCC" | "BCC";

/**
 * Road state of one canyon, derived in code from road notices and signs.
 * "closed-expected-open" = closed now with a published (re)opening time.
 */
export type CanyonState = "open" | "closed-expected-open" | "closed" | "interlodge" | "unknown";

export interface CanyonStatus {
  canyon: CanyonId;
  state: CanyonState;
  /** Published (re)opening time while closed, ISO UTC. */
  expectedOpenAt: string | null;
  /** Announced upcoming closure (e.g. "will close at 10 PM"), ISO UTC when a time is given. */
  closureAnnounced: { text: string; at: string | null } | null;
  /** Traction / chain restrictions currently posted. */
  restrictions: string[];
  /** Road texts the state was derived from (seasonal gate notices excluded). */
  evidence: string[];
}

export type RecommendationMode = "storm" | "fair";

export interface Recommendation {
  /** Denver calendar date (YYYY-MM-DD) the pick is for: today before 2 PM, tomorrow after. */
  targetDate: string;
  mode: RecommendationMode;
  /** null = explicit "no pick". */
  pick: PrimaryResortId | null;
  /** One-line strategy, e.g. "Line up at the LCC mouth by 8:00 for the 9:30 opening". */
  plan: string;
  headline: string;
  /** 2–3 sentences on why this pick; empty for a rule-based "no pick". Absent on picks stored before it existed. */
  summary?: string;
  caveats: string[];
  runnerUp: PrimaryResortId | null;
  generatedAt: string;
  /** Model id, or null for a rule-based "no pick" (no LLM call). */
  model: string | null;
  /** Why this update ran (scheduling trigger). */
  trigger: string;
}

export interface RecommendationState {
  current: Recommendation | null;
  /** Completion of the last attempt; absent in legacy snapshots. */
  lastFinishedAt?: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Inputs of the current recommendation, for change detection (see recommend/schedule.ts). */
  fingerprint: string | null;
  criticalKey: string | null;
  /** Reserved model requests per Denver day (two per attempt), for the daily cap. */
  calls: { date: string; count: number };
  /** Last time each resort was seen with lifts running (season detection). */
  resortLastOperatingAt: Partial<Record<PrimaryResortId, string>>;
}

export interface ApiRecommendation extends Recommendation {
  /** The pick is for a past day, or has not been refreshed for too long. */
  outdated: boolean;
  /** Recent update attempts are failing (the last good pick is still shown). */
  failing: boolean;
}

// ---------- API response ----------

export type Freshness =
  /** Collection healthy and upstream report time within the source's window. */
  | "current"
  /** Collection healthy but upstream report is old (e.g. yesterday's report). */
  | "old-report"
  /** Collection healthy but the source gives no publication time. */
  | "time-unknown"
  /** No successful collection within the expected window; serving the last successful payload. */
  | "stale"
  /** Never collected successfully. */
  | "unavailable";

export interface ApiSource<P = unknown> extends SourceRecord<P> {
  label: string;
  category: SourceCategory;
  required: boolean;
  attribution: string;
  sourceUrl: string;
  freshness: Freshness;
  freshnessNote: string;
}

export interface ReportResponse {
  generatedAt: string;
  snapshotWrittenAt: string | null;
  collectionIntervalMinutes: number;
  sources: Record<SourceId, ApiSource>;
  /** Missing required sources — a v1 release blocker if persistently non-empty. */
  requiredMissing: SourceId[];
  /** AI resort pick; null until one has been generated. */
  recommendation: ApiRecommendation | null;
  /** AI Daily Snow post; null until one has been generated. */
  dailySnow?: ApiDailySnow | null;
}

// ---------- NWS Area Forecast Discussion ----------

export interface AfdPayload {
  productId: string;
  office: string;
  issuedAt: string;
  /**
   * Forecast-relevant sections in product order (aviation, hydrology, etc. dropped).
   * `issued` is set when an updated product carries a section over from an
   * earlier issuance (".DISCUSSION, Issued 1037 PM MST Sun Nov 1 2026...").
   */
  sections: Array<{ name: string; text: string; issued?: string }>;
}

// ---------- AI Daily Snow ----------

/** Where the storm cycle stands, decided in code (see dailysnow/digest.ts). */
export type DailySnowPhase = "pre-storm" | "storm" | "post-storm" | "quiet";
export type DailySnowSectionId = "update" | "short-term" | "extended";

/** Figures are data or stored stills, frozen at posting time. Captions come from code, never the model. */
export type DailySnowFigure = { id: string; caption: string } & (
  | { kind: "snow-bars"; canyon: CanyonId; bars: SixHourSnow[] }
  | { kind: "snow-level"; series: Array<{ canyon: CanyonId; points: Array<{ start: string; ft: number }> }> }
  | { kind: "totals"; rows: Array<{ name: string; h24: number | null; h48: number | null; storm: number | null }> }
  | { kind: "storm-recap"; storm: StormRecord }
  | {
      kind: "image";
      /** Same-origin URL of the still copied into KV at posting time. */
      url: string;
      /** Where the original image came from (copied when the post is written). */
      originUrl: string;
      width: number | null;
      height: number | null;
      /**
       * Plume panels only: where the time axis sits in the still, so it is drawn
       * like the plumes page (Mountain Time labels replace the cropped UTC ones).
       * Optional for compatibility with posts written before axis metadata was stored.
       */
      axis?: { plot: PlumePanel["plot"]; initTime: string; forecastHours: number };
    }
);

export interface DailySnowParagraph {
  text: string;
  /** Figure shown after this paragraph (id into DailySnowPost.figures). */
  figure: string | null;
}

/** Code-computed totals at posting time (never model-written); kept for forecast verification in later posts. */
export interface DailySnowNumbers {
  canyons: Array<{
    canyon: CanyonId;
    point: string;
    next24In: number | null;
    next72In: number | null;
    next7dIn: number | null;
    nextStorm: NextStorm | null;
    forecastUpdatedAt: string | null;
  }>;
  resorts: Array<{ id: PrimaryResortId; name: string; h24: number | null; storm: number | null; reportTime: string | null; h48?: number | null; seasonIn?: number | null }>;
}

export interface DailySnowPost {
  /** Denver calendar date of the post (YYYY-MM-DD). */
  date: string;
  phase: DailySnowPhase;
  title: string;
  summary: string;
  sections: Array<{ id: DailySnowSectionId; paragraphs: DailySnowParagraph[] }>;
  figures: Record<string, DailySnowFigure>;
  numbers: DailySnowNumbers;
  /** Immutable edition-specific copy, shared by the prose digest and recap figure. */
  stormRecap?: StormRecord;
  generatedAt: string;
  model: string;
  trigger: string;
  /** Set when the fallback model wrote the post: why the primary model failed. */
  fallbackReason?: string;
  /** The post before this one, set when it is written. With `newer`, chains every post for the prev/next links. */
  older?: DailySnowLink;
  /** The post after this one, added to this post when that one is written. Absent on the latest post. */
  newer?: DailySnowLink;
}

/** A neighboring post, for archive navigation. */
export interface DailySnowLink {
  date: string;
  title: string;
}

/** Compact record of a past post: archive navigation and forecast verification. */
export interface DailySnowHistoryEntry {
  date: string;
  title: string;
  phase: DailySnowPhase;
  /** When the post was written. Absent on entries stored before 2026-11-03. */
  postedAt?: string;
  forecast: Array<{
    canyon: CanyonId;
    next24In: number | null;
    next72In: number | null;
    stormIn: number | null;
    /** Window of the storm `stormIn` belongs to, so later posts can match it. Absent on entries stored before 2026-11-03. */
    storm?: { start: string; end: string } | null;
  }>;
}

export interface DailySnowState {
  current: DailySnowPost | null;
  lastAttemptAt: string | null;
  /** End of the last attempt; an attempt newer than this is still running (or was cut off). */
  lastFinishedAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Scheduled attempts and reserved model requests per Denver day. */
  attempts: { date: string; count: number; calls: number };
  /** Most recent posts first (at most DAILY_SNOW_ARCHIVE_POSTS). */
  history: DailySnowHistoryEntry[];
}

export type DailySnowPublicationStatus = "current" | "scheduled" | "pending" | "delayed" | "paused";

export interface ApiDailySnow extends DailySnowPost {
  /** Edition date differs from today. Retained for API compatibility; not a publication warning. */
  outdated: boolean;
  /** Schedule-aware availability of the replacement edition. Optional for older responses. */
  publicationStatus?: DailySnowPublicationStatus;
  /** Recent attempts are failing (the last good post is still shown). */
  failing: boolean;
  /** Most recent posts, newest first (at most DAILY_SNOW_ARCHIVE_POSTS). */
  archive: Array<{ date: string; title: string }>;
}

/** Each variable is percentile rows × 40 six-hour lead columns. Totals are from initialization. */
export type EnsembleVariable = "totalLiquidIn" | "totalSnowIn" | "liquidIn" | "snowIn" | "slr" | "wetBulbHalfFt";
export interface EnsemblePayload {
  /** Exact -0.01 in six-hour liquid normalized to zero; no other negative accepted. */
  traceLiquidCorrections: number;
  sourceUrl: string;
  model: string;
  station: "CLN";
  scope: string;
  latitude: number;
  longitude: number;
  elevationFt: number;
  initializedAt: string;
  members: number;
  periodEnds: string[];
  percentiles: string[];
  values: Record<EnsembleVariable, number[][]>;
}
