/**
 * Clip generated prose to a hard character budget without mangling it.
 *
 * The model can overrun a paragraph budget, so validators cap the text — but
 * cutting at an arbitrary character index can end a sentence mid-word ("En…"
 * for "Ensemble"). This clips at the last complete sentence that keeps most of
 * the budget, and otherwise at the last word boundary with an ellipsis.
 */
export function clipText(input: unknown, max: number): string {
  const t = typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  // A sentence must keep at least 60% of the budget; a lone short opening
  // sentence reads worse than a word-boundary ellipsis.
  const min = Math.ceil(max * 0.6);
  let end = 0;
  for (const m of head.matchAll(/[.!?]["”’')]*(?=\s)/g)) {
    const sentenceEnd = m.index + m[0].length;
    if (sentenceEnd >= min) end = sentenceEnd;
  }
  if (end) return head.slice(0, end);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).trimEnd()}…`;
}
