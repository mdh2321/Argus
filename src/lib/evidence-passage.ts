export interface PassageRequest {
  documentId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sectionRef?: string | null;
  claim?: string | null;
  quote?: string | null;
  quoteStart?: number | null;
  quoteEnd?: number | null;
}
export interface PassageMatch { start: number; end: number; kind: "quote" | "section" }

export function locatePassage(text: string, request: PassageRequest): PassageMatch | null {
  const { quote, quoteStart: start, quoteEnd: end } = request;
  // Stored offsets alone are not proof: a refetch may have changed the text.
  if (quote && Number.isInteger(start) && Number.isInteger(end) && start! >= 0 && end! > start! && end! <= text.length && text.slice(start!, end!) === quote) {
    return { start: start!, end: end!, kind: "quote" };
  }
  if (quote) {
    const found = text.indexOf(quote);
    if (found >= 0 && text.indexOf(quote, found + 1) < 0) return { start: found, end: found + quote.length, kind: "quote" };
  }
  const ref = request.sectionRef?.trim();
  if (!ref) return null;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const schedule = ref.match(/^(?:schedule|part|article)\s+[\dIVX]+[A-Z]*/i);
  const section = ref.match(/^(?:s(?:ection)?s?\.?\s*)?(\d+[A-Z]*)(?:\s*\([^)]+\))?/i);
  let pattern: RegExp | null = null;
  if (schedule) pattern = new RegExp(`^(?:#{1,6}\\s*)?${escape(schedule[0])}(?=\\s|[—–.:-]|$)[^\\n]*`, "gim");
  else if (section) pattern = new RegExp(`^(?:#{1,6}\\s*)?(?:Section\\s+)?${escape(section[1])}(?=\\s|[—–.:-])[^\\n]*`, "gim");
  const matches = (pattern ? [...text.matchAll(pattern)] : []).filter(m => {
    const line = m[0].replace(/^#{1,6}\s*/, "").trim();
    // Exclude dotted contents entries and PDF running headers, never choose
    // between two plausible body headings. These are source-format checks.
    return !/\.{2,}|…/.test(line) && !/^Section\s+\d+[A-Z]*$/i.test(line) && !/Compilation (?:No\.|date:)/i.test(line);
  });
  // Duplicate headings (often a contents page and the body) are ambiguous.
  // Offer the source rather than suggesting a false pinpoint.
  if (matches.length !== 1) return null;
  return { start: matches[0].index!, end: matches[0].index! + matches[0][0].length, kind: "section" };
}
