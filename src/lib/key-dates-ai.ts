import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { DeadlineKind, KeyDate } from "@/lib/types";
import { classifyDeadlineKind } from "@/lib/deadline-kind";

const client = new Anthropic();
// Date extraction is mechanical scanning, not legal reasoning — same tier
// call as defined-terms extraction (H1).
const MODEL = "claude-haiku-4-5-20251001";

// Cap per-doc input. Commencement/application provisions cluster at the front
// of an instrument (ss 1-3) and transition provisions at the end, but 150k
// chars covers all of most instruments outright.
const DOC_SLICE = 150000;

export interface ExtractedKeyDate extends KeyDate {
  kind: DeadlineKind;
  docName: string;
}

interface ExtractInput {
  entryName: string;
  docs: { name: string; fullText: string }[];
  today: string; // YYYY-MM-DD
}

// Extract dated milestones from an entry's source documents: commencement and
// application dates, transition-period ends, consultation/submission windows,
// expected publications. Returns [] on model/parse failure — callers treat
// the pass as best-effort.
export async function extractKeyDates(input: ExtractInput): Promise<ExtractedKeyDate[]> {
  const docBlocks = input.docs
    .map(
      (d) =>
        `<document name="${d.name.replace(/"/g, "'")}">\n${d.fullText.slice(0, DOC_SLICE)}\n</document>`
    )
    .join("\n\n");

  const prompt = `You are a legal text extraction tool. Extract every DATED MILESTONE from these source documents for the instrument "${input.entryName}". Today's date is ${input.today}.

A dated milestone is a specific calendar date on which something legally significant happens. Extract:
  - Commencement / entry into force / effective dates (including staged commencement per Part/Division)
  - Application dates ("applies from", "has effect on and after")
  - Transition or grace period ends
  - Compliance deadlines ("must register by", "must comply by")
  - Consultation windows: submissions/comments due, hearing dates
  - Repeal or sunset dates
  - Expected/announced future events with a stated date (publication of rules, review report due)

DO NOT extract:
  - Dates without legal significance (dates in examples, citation dates of other instruments, historical recitals)
  - Relative dates with no resolvable calendar date ("6 months after commencement" — UNLESS the commencement date is stated, in which case resolve it and note the derivation in the label)
  - Dates of past procedural steps unless they anchor something (assent date is worth extracting once)

For each milestone return:
- "date": YYYY-MM-DD. If only month/year is given, use the first day and say "(from [Month Year])" in the label.
- "label": short human label, e.g. "Part 2 commences", "Submissions close", "Transition period ends". ≤80 chars.
- "kind": one of:
    * "compliance" — an obligation lands (in force, applies, transition ends, comply-by)
    * "process" — a window to act closes (consultation, submissions, hearing)
    * "watch" — an event to monitor (expected publication, review report, assent, sunset)
- "sectionRef": the provision the date comes from (e.g. "s 2", "cl 14", "Sch 1 item 3"), or null.
- "docName": the name of the document it was found in, exactly as given.

If a document contains no dated milestones, contribute nothing for it. Prefer precision over recall — a wrong date is worse than a missed one.

${docBlocks}

Return ONLY valid JSON:
{
  "dates": [
    { "date": "2027-03-01", "label": "Part 2 commences", "kind": "compliance", "sectionRef": "s 2", "docName": "..." }
  ]
}`;

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    raw = block?.type === "text" ? block.text : "";
  } catch (err) {
    console.error("Key-date extraction call failed:", err);
    return [];
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let parsed: { dates?: unknown } = {};
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.dates)) return [];

  const out: ExtractedKeyDate[] = [];
  for (const item of parsed.dates) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    if (typeof d.label !== "string" || !d.label.trim()) continue;
    const label = d.label.trim().slice(0, 120);
    const kind =
      d.kind === "compliance" || d.kind === "process" || d.kind === "watch"
        ? d.kind
        : classifyDeadlineKind(label);
    out.push({
      date: d.date,
      label,
      kind,
      sectionRef: typeof d.sectionRef === "string" && d.sectionRef.trim() ? d.sectionRef.trim() : null,
      docName: typeof d.docName === "string" ? d.docName : "",
    });
  }
  return out;
}

// Merge extracted dates into the entry's existing keyDates. Existing dates
// win: an extracted date is dropped when the entry already has any date on
// the same day (the analyst's label is presumed better), otherwise appended.
// Returns the merged list sorted by date, plus how many were added.
export function mergeKeyDates(
  existing: KeyDate[],
  extracted: ExtractedKeyDate[]
): { merged: KeyDate[]; added: KeyDate[] } {
  const byDate = new Set(existing.map((kd) => kd.date));
  const added: KeyDate[] = [];
  for (const ex of extracted) {
    if (byDate.has(ex.date)) continue;
    byDate.add(ex.date);
    added.push({ date: ex.date, label: ex.label, kind: ex.kind, sectionRef: ex.sectionRef ?? null });
  }
  const merged = [...existing, ...added].sort((a, b) => a.date.localeCompare(b.date));
  return { merged, added };
}
