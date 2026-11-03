/** Source attribution for new output and older saved editions. */
export function readerWording(text: string): string {
  return text.replace(/\b(?:the\s+)?(?:NWS\s+)?(?:forecast\s+)?discussion\b/gi, (match, offset: number) =>
    offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset)) ? "The NWS" : "the NWS");
}
