"use client";

// v2 entry-page primitives.
//
// Three ideas carry the redesign and all of them live here:
//
//  1. Citations are quiet numeric markers, not inline chips. A marker that
//     renders the provision inline ("Privacy Act, s 5B") is scannable, but at
//     ~50 citations down a page it competes with the prose it is supporting.
//     A small superscript number keeps the sentence readable and puts the
//     reference one hover away. Numbers are assigned per distinct source
//     reference across the whole entry, so the same provision cited in four
//     places is always [3] — a real footnote apparatus rather than a running
//     count.
//  2. Confidence sits beside each assessed section, with its stored basis
//     available on hover or keyboard focus.
//  3. Long generated prose is condensed to its operative clause, with the
//     full text one click away. The generator currently emits consultant-length
//     actions ("Audit and update Docusign's Australian APP privacy policy to
//     confirm it expressly covers: (a) …"); until the prompt is fixed the UI
//     shows the verb and the object, not the paragraph.

import { createContext, useContext, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { Entry, EntryClaim, EntryClaimCitation, SectionConfidence, SourceDocument } from "@/lib/types";
import { openEvidence } from "@/components/evidence/evidence-panel";
import { CONFIDENCE_LEVELS } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Citation numbering
// ---------------------------------------------------------------------------

// Identity of a cited source. Two citations pointing at the same provision of
// the same document share a number, however many times they appear.
function citationKey(cite: EntryClaimCitation): string | null {
  const target = cite.sourceDocumentId ?? cite.sourceUrl ?? null;
  const ref = cite.sectionRef ?? null;
  if (!target && !ref) return null;
  return `${target ?? "-"}|${ref ?? "-"}`;
}

const CitationIndexContext = createContext<Map<string, number> | null>(null);
const CitationDocumentsContext = createContext<SourceDocument[]>([]);

// Fixed reading order: Overview first, then Analysis. Numbering is derived
// from the entry data rather than from render order so a marker keeps the same
// number whichever tab you land on — deep-linking to ?tab=analysis must not
// renumber the footnotes.
const NUMBERING_ORDER = [
  "summary",
  "applicability",
  "exemptions",
  "keyCriteria",
  "penalties",
  "whyItMatters",
  "complianceImplications",
  "openQuestions",
  "relatedContext",
] as const;

export function buildCitationIndex(entry: Entry): Map<string, number> {
  const index = new Map<string, number>();
  let next = 1;

  const take = (cite: EntryClaimCitation | null | undefined) => {
    if (!cite) return;
    const key = citationKey(cite);
    if (!key || index.has(key)) return;
    index.set(key, next++);
  };

  const claims = entry.sectionClaims ?? {};
  for (const section of NUMBERING_ORDER) {
    for (const claim of claims[section] ?? []) take(claim.citation);
    // Threshold tests sit inside Application and scope, so their pinpoints are
    // numbered immediately after that section's claims.
    if (section === "applicability") {
      for (const test of entry.thresholdTests ?? []) {
        if (test.sectionRef) take({ sectionRef: test.sectionRef });
      }
    }
    if (section === "complianceImplications") {
      for (const item of entry.complianceChecklist ?? []) {
        if (item.sectionRef) take({ sectionRef: item.sectionRef });
      }
    }
  }

  return index;
}

export function CitationIndexProvider({
  entry,
  documents = [],
  children,
}: {
  entry: Entry;
  documents?: SourceDocument[];
  children: React.ReactNode;
}) {
  const index = useMemo(() => buildCitationIndex(entry), [entry]);
  return <CitationIndexContext.Provider value={index}><CitationDocumentsContext.Provider value={documents}>{children}</CitationDocumentsContext.Provider></CitationIndexContext.Provider>;
}

// ---------------------------------------------------------------------------
// Citation marker
// ---------------------------------------------------------------------------

function sourceLabel(cite: EntryClaimCitation): string {
  const parts: string[] = [];
  if (cite.sourceDocumentName) parts.push(cite.sourceDocumentName);
  else if (cite.sourceUrl) {
    try {
      parts.push(new URL(cite.sourceUrl).hostname.replace(/^www\./, ""));
    } catch {
      /* fall through to the section ref alone */
    }
  }
  if (cite.sectionRef) parts.push(cite.sectionRef);
  return parts.join(" · ") || "Source";
}

/**
 * A small superscript number. Hover or focus reveals the reference; clicking
 * opens the passage in the Instrument reader.
 */
export function CitationRef({ claim }: { claim: EntryClaim }) {
  const cite = claim.citation;
  const index = useContext(CitationIndexContext);
  const documents = useContext(CitationDocumentsContext);
  if (!cite) return null;

  const key = citationKey(cite);
  if (!key) return null;

  const number = index?.get(key);
  if (!number) return null;

  const verified = !!(cite.quoteVerified && cite.quote);
  const fallback = cite.sourceUrl ? documents.find(d => d.sourceUrl === cite.sourceUrl) : documents.find(d => d.role === "primary_text");
  const documentId = cite.sourceDocumentId ?? fallback?.id;
  const canReveal = !!documentId;
  const label = sourceLabel(cite);

  const marker = (
    <>
      <span aria-hidden="true">{number}</span>
      <span className="sr-only">
        {`Source ${number}: ${label}.${verified ? " Quoted passage available." : ""}${
          canReveal ? " Opens the cited passage." : ""
        }`}
      </span>
    </>
  );

  const markerClass =
    "inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[2px] border-b border-border-hover/70 font-mono text-[12px] leading-none tabular-nums text-fg-3 transition-colors hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-none";

  return (
    <span className="group/cite relative ml-0.5 inline-block align-super">
      <button type="button" className={markerClass} onClick={() => openEvidence({
        documentId, sourceName: cite.sourceDocumentName, sourceUrl: cite.sourceUrl,
        sectionRef: cite.sectionRef, claim: claim.text, quote: cite.quote,
        quoteStart: cite.quoteStart, quoteEnd: cite.quoteEnd,
      })}>{marker}</button>
      <CitationTooltip number={number} label={label} cite={cite} />
    </span>
  );
}

// Hover/focus tooltip. Mirrors the mock's ::after treatment — centred above the
// marker, appearing on both hover and keyboard focus.
function CitationTooltip({
  number,
  label,
  cite,
}: {
  number: number;
  label: string;
  cite: EntryClaimCitation;
}) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[19rem] -translate-x-1/2 rounded-md border border-border-hover bg-surface px-2.5 py-2 text-left text-[10.5px] font-normal leading-[1.45] text-fg shadow-xl group-hover/cite:block group-focus-within/cite:block"
    >
      <span className="block">
        <span className="font-mono text-fg-3">{number}.</span> {label}
      </span>
      {cite.quoteVerified && cite.quote && (
        <span className="mt-1.5 block border-t border-border/60 pt-1.5">
          <span className="inline-flex items-center gap-1 text-[9.5px] font-medium text-[var(--green-text)]">
            <ShieldCheck className="h-2.5 w-2.5" />
            Quoted passage
          </span>
          <span className="mt-1 block border-l-2 border-[color:var(--green)]/40 pl-2 italic text-fg-2">
            &ldquo;{cite.quote.slice(0, 180)}
            {cite.quote.length > 180 ? "…" : ""}&rdquo;
          </span>
        </span>
      )}
      {cite.note && (
        <span className="mt-1.5 block border-t border-border/60 pt-1.5 text-fg-3">{cite.note}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Confidence — the same indicator for every assessed section
// ---------------------------------------------------------------------------

export function ConfidenceMark({ confidence }: { confidence?: SectionConfidence }) {
  if (!confidence) return null;
  const config = CONFIDENCE_LEVELS.find((c) => c.value === confidence.level);
  if (!config) return null;

  return (
    <span className="group/conf relative" tabIndex={0} aria-label={`${config.label} confidence${confidence.basis ? `: ${confidence.basis}` : ""}`}>
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none"
        style={{
          color: config.color,
          background: `${config.color}15`,
          border: `1px solid ${config.color}30`,
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.color }} />
        {config.label} confidence
      </span>
      {confidence.basis && (
        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] leading-relaxed text-fg-2 shadow-xl group-hover/conf:block group-focus/conf:block">
          {confidence.basis}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function Section({
  id,
  title,
  kicker,
  confidence,
  actions,
  children,
}: {
  id?: string;
  title: string;
  kicker?: string;
  confidence?: SectionConfidence;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {kicker && <span className="text-[14px] text-fg-3">{kicker}</span>}
        <ConfidenceMark confidence={confidence} />
        {actions && <span className="ml-auto">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prose + claims
// ---------------------------------------------------------------------------

// Generated prose sometimes leads with an intro paragraph before the bulleted
// claims repeat it in structured form. Keep the intro only when it isn't just
// a restatement of the first claim.
function introOf(text: string | null | undefined, claims: EntryClaim[]): string | null {
  if (!text) return null;
  const first = text.split(/\n\s*\n/)[0]?.trim();
  if (!first) return null;
  if (first.startsWith("-") || first.startsWith("•")) return null;
  const firstClaim = claims[0]?.text ?? "";
  if (firstClaim && first.slice(0, 60) === firstClaim.slice(0, 60)) return null;
  return first;
}

export function ClaimProse({
  text,
  claims,
  empty = "Not yet assessed.",
}: {
  text: string | null | undefined;
  claims?: EntryClaim[] | null;
  empty?: React.ReactNode;
}) {
  if (claims && claims.length > 0) {
    const intro = introOf(text, claims);
    return (
      <div className="space-y-3">
        {intro && <p className="text-[16px] leading-relaxed text-fg-2">{intro}</p>}
        <ul className="space-y-2">
          {claims.map((claim, i) => (
            <li key={i} className="flex gap-2.5 text-[16px] leading-relaxed text-fg-2">
              <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-fg-3/50" />
              <span className="min-w-0">
                {claim.text}
                <CitationRef claim={claim} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (text) return <Prose text={text} />;
  return <p className="text-[15px] text-fg-3">{empty}</p>;
}

// Plain prose renderer. Splits on blank lines and renders leading "-"/"•"
// runs as lists, which is the shape the generator emits.
export function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((l) => /^[-•*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-2.5 text-[16px] leading-relaxed text-fg-2">
                  <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-fg-3/50" />
                  <span className="min-w-0">{line.replace(/^[-•*]\s+/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-[16px] leading-relaxed text-fg-2">
            {block.replace(/\n/g, " ")}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Condensing long generated actions
// ---------------------------------------------------------------------------

// Clause openers that reliably start a qualifying tail rather than the point
// itself: "…privacy policy | to confirm it expressly covers (a)…".
const CLAUSE_OPENERS = [
  /\s+\(/,
  /\s+to\s+\w/,
  /\s+that\s+/,
  /\s+which\s+/,
  /\s+with\s+/,
  /\s+including\b/,
  /\s+covering\b/,
  /\s+protecting\b/,
  /\s+calibrated\b/,
  /\s+for\s+each\b/,
];

// Structural punctuation: colon, semicolon, em-dash, sentence end, enumerator.
const STRUCTURAL = /(\s+[—–]\s+|:\s|;\s|\.\s+|\s+\((?:a|i|1)\))/;

/**
 * Cut verbose generated prose down to its operative clause, keeping the rest
 * for on-demand expansion.
 *
 * This is a stopgap. The durable fix is upstream: the generator emits 200-400
 * character actions that bury the instruction under an enumerated scope, and
 * no amount of client-side trimming turns "Audit and update X to confirm it
 * expressly covers: (a)…(d)" into a well-written requirement. It does make the
 * page readable in the meantime.
 *
 * The floor scales with the limit — a 96-character requirement line and a
 * 130-character open question need different minimum useful lengths, and a
 * fixed floor cut short questions off at their subject ("Is the Docusign
 * entity an 'organisation'") while leaving requirements too long.
 */
export function condense(text: string, limit = 96): { head: string; rest: string | null } {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return { head: clean, rest: null };

  const floor = Math.max(28, Math.round(limit * 0.55));
  const candidates: number[] = [];

  const structural = clean.search(STRUCTURAL);
  if (structural >= floor) candidates.push(structural);

  for (const opener of CLAUSE_OPENERS) {
    const at = clean.search(opener);
    if (at >= floor) candidates.push(at);
  }

  const inRange = candidates.filter((c) => c <= limit);
  let cut = inRange.length > 0 ? Math.min(...inRange) : -1;

  if (cut < 0) {
    const comma = clean.lastIndexOf(",", limit);
    cut = comma >= floor ? comma : clean.lastIndexOf(" ", limit);
    if (cut < floor) cut = limit;
  }

  const head = clean.slice(0, cut).replace(/[\s,;:(]+$/, "");
  return { head, rest: clean.slice(cut).trim() || null };
}

export function ExpandableText({
  head,
  rest,
  className = "",
}: {
  head: string;
  rest: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!rest) return <span className={className}>{head}</span>;

  return (
    <span className={className}>
      {open ? `${head} ${rest}` : `${head}…`}{" "}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] text-fg-3 transition-colors hover:text-accent"
      >
        {open ? "less" : "more"}
      </button>
    </span>
  );
}
