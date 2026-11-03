import { inchAmounts } from "../ai/grounding";

/**
 * Check explicit, unambiguous resort/storm-total claims exactly (the generic
 * amount check permits a 1-inch tolerance and cannot check source/window).
 * Complex multi-amount clauses still rely on the prompt and the code figure;
 * this deliberately does not pretend to be a general natural-language parser.
 */
export function validateStormAttribution(text: string, storm: { resorts: Array<{ name: string; total: { amountIn: number } | null }> }): void {
  const names = storm.resorts.map((r) => r.name).join("|");
  for (const sentence of text.split(/[.!?](?:\s+|$)/)) {
    const mentions = [...sentence.matchAll(new RegExp(`\\b(${names})\\b`, "gi"))];
    for (let i = 0; i < mentions.length; i++) {
      const m = mentions[i];
      const clause = sentence.slice(m.index, mentions[i + 1]?.index);
      if (!/\bstorm\s+total\b|\bfor\s+(?:the\s+)?storm\b/i.test(clause)) continue;
      if (/\b(?:no|not|unknown|unavailable|hasn['’]t|didn['’]t|doesn['’]t)\b/i.test(clause)) continue;
      if (/\bsince\s+(?:the\s+)?reset\b/i.test(clause)) continue;
      const amounts = inchAmounts(clause);
      if (amounts.length !== 1) continue;
      const r = storm.resorts.find((r) => r.name.toLowerCase() === m[1].toLowerCase())!;
      if (!r.total || amounts[0] !== r.total.amountIn) {
        throw new Error(`Model output assigns an unsupported storm total to ${r.name}`);
      }
    }
  }
}
