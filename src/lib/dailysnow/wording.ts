/**
 * Source attribution for new output and older saved editions. Only rewrites a
 * reference to the NWS discussion ("the discussion", "the NWS forecast
 * discussion", "the Area Forecast Discussion"), never the ordinary word.
 */
const DISCUSSION = /\b(?:the\s+(?:NWS(?:['’]s)?\s+)?|NWS(?:['’]s)?\s+)(?:area\s+)?(?:forecast\s+)?discussion\b/gi;

export function readerWording(text: string): string {
  return text.replace(DISCUSSION, (_match, offset: number) =>
    offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset)) ? "The NWS" : "the NWS");
}
