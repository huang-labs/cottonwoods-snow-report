/**
 * Source attribution for new output and older saved editions. Only rewrites a
 * reference to the NWS discussion ("the discussion", "the NWS forecast
 * discussion", "the Area Forecast Discussion"), never the ordinary word.
 */
const DISCUSSION = /\b(?:the\s+(?:NWS(?:['’]s)?\s+)?|NWS(?:['’]s)?\s+)(?:area\s+)?(?:forecast\s+)?discussion\b/gi;
/** Model-written figure citations are placement metadata, never article copy. */
const FIGURE_MARKER = /\[(?:storm-recap|resort-totals|nws-snow-(?:lcc|bcc|level)|plume-(?:snow|slr)-[a-z0-9]+|stake-(?:alta|snowbird|solitude|brighton))\]/gi;

export function readerWording(text: string): string {
  // Also runs when displaying saved editions, so no archive rewrite is needed.
  text = text.replace(FIGURE_MARKER, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.;:!?])/g, "$1").trim();
  return text.replace(DISCUSSION, (_match, offset: number) =>
    offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset)) ? "The NWS" : "the NWS");
}
