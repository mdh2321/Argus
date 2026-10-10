"use client";

// Instrument reader — the official text as a reading surface.
//
// v1 rendered the primary source as `whitespace-pre-wrap` inside a 384px
// scroll box nested two levels down the Source Documents section. For a tool
// whose whole claim is that the analysis is grounded in primary law, the law
// itself deserves better than a textarea.
//
// This is paginated rather than virtualised: the Privacy Act compilation is
// 665k characters, and a legal reader wants stable page boundaries and a part
// index far more than they want infinite scroll. Pages break at heading or
// paragraph boundaries so a provision is never split mid-sentence.

import { openEvidence } from "@/components/evidence/evidence-panel";
import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from "lucide-react";
import type { SourceDocument } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const TARGET_PAGE_CHARS = 14_000;

interface Heading {
  level: number;
  text: string;
  offset: number;
}

interface Page {
  start: number;
  end: number;
}

function parseHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const re = /^(#{2,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ level: m[1].length, text: m[2].trim(), offset: m.index });
  }
  return out;
}

// Break into pages near TARGET_PAGE_CHARS, preferring a heading boundary and
// falling back to a blank line, so provisions stay intact across the seam.
function paginate(text: string): Page[] {
  const pages: Page[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const ideal = cursor + TARGET_PAGE_CHARS;
    if (ideal >= text.length) {
      pages.push({ start: cursor, end: text.length });
      break;
    }

    const window = text.slice(ideal, Math.min(ideal + 4_000, text.length));
    const headingAt = window.search(/\n#{2,6}\s+/);
    let cut: number;
    if (headingAt >= 0) {
      cut = ideal + headingAt + 1;
    } else {
      const paraAt = window.search(/\n\s*\n/);
      cut = paraAt >= 0 ? ideal + paraAt + 1 : ideal;
    }

    pages.push({ start: cursor, end: cut });
    cursor = cut;
  }

  return pages;
}

export function InstrumentReader({
  documents,
  entryId,
}: {
  documents: SourceDocument[] | undefined;
  entryId: string;
}) {
  const docs = documents ?? [];
  const primary = docs.find((d) => d.role === "primary_text" && d.fullText) ?? null;
  const withText = docs.filter((d) => d.fullText);

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const doc = withText.find((d) => d.id === activeDocId) ?? primary ?? withText[0] ?? null;

  if (!doc || !doc.fullText) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center">
        <FileText className="mx-auto mb-3 h-5 w-5 text-fg-3" />
        <p className="text-[15px] text-fg-2">No instrument text is attached to this entry.</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-fg-3">
          Attach the official legislation text on the Sources tab so the analysis can be grounded
          in the instrument itself.
        </p>
      </div>
    );
  }

  return (
    <Reader
      key={doc.id}
      doc={doc}
      siblings={withText}
      onSwitch={setActiveDocId}
      entryId={entryId}
    />
  );
}

function Reader({
  doc,
  siblings,
  onSwitch,
  entryId,
}: {
  doc: SourceDocument;
  siblings: SourceDocument[];
  onSwitch: (id: string) => void;
  entryId: string;
}) {
  const text = doc.fullText ?? "";
  const { pages, headings } = useMemo(
    () => ({ pages: paginate(text), headings: parseHeadings(text) }),
    [text]
  );

  const [pageIndex, setPageIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const page = pages[Math.min(pageIndex, pages.length - 1)] ?? { start: 0, end: text.length };

  const parts = headings.filter((h) => h.level <= 4);

  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      {/* Structural index */}
      <nav className="hidden lg:block" aria-label="Instrument contents">
        <div className="sticky top-24">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">
            On this instrument
          </h2>
          <ul className="max-h-[calc(100vh-14rem)] space-y-px overflow-y-auto pr-1">
            {parts.map((heading) => {
              const active = heading.offset >= page.start && heading.offset < page.end;
              return (
                <li key={heading.offset}>
                  <button
                    type="button"
                    onClick={() => openEvidence({ documentId: doc.id, sectionRef: heading.text, quoteStart: heading.offset, quoteEnd: text.indexOf("\n", heading.offset) < 0 ? text.length : text.indexOf("\n", heading.offset), quote: text.slice(heading.offset, text.indexOf("\n", heading.offset) < 0 ? text.length : text.indexOf("\n", heading.offset)) })}
                    className={`block w-full rounded px-2 py-1.5 text-left text-[14px] leading-snug transition-colors hover:bg-hover ${
                      active ? "bg-hover font-medium text-accent" : "text-fg-2"
                    }`}
                  >
                    {shortHeading(heading.text)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Reading surface */}
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-semibold text-fg">{doc.name}</h2>
            <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.05em] text-fg-3">
              {doc.charCount ? `${doc.charCount.toLocaleString()} chars` : "text extracted"}
              {" · "}
              {pages.length} {pages.length === 1 ? "page" : "pages"}
              {doc.retrievedAt ? ` · retrieved ${formatDate(doc.retrievedAt)}` : ""}
            </p>
          </div>
          <button type="button" className="argus-secondary" onClick={() => openEvidence({ documentId: doc.id })}>Open reader panel</button>
        {doc.sourceUrl && (
            <a
              href={doc.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[12px] text-accent transition-colors hover:text-accent-2"
            >
              Official copy <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {siblings.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {siblings.map((sibling) => (
              <button
                key={sibling.id}
                type="button"
                onClick={() => onSwitch(sibling.id)}
                className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                  sibling.id === doc.id
                    ? "border-border-hover bg-hover text-fg"
                    : "border-border text-fg-3 hover:text-fg-2"
                }`}
              >
                {sibling.role === "primary_text" ? "The instrument" : sibling.name}
              </button>
            ))}
          </div>
        )}

        <div
          ref={bodyRef}
          className="rounded-xl border border-border bg-surface px-6 py-6 sm:px-8"
        >
          <PageBody
            text={text}
            page={page}
          />
        </div>

        <Pager
          pageIndex={Math.min(pageIndex, pages.length - 1)}
          pageCount={pages.length}
          onChange={(next) => {
            setPageIndex(next);
            bodyRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
        />

        <p className="mt-4 text-[12px] leading-relaxed text-fg-3">
          Extracted text, shown for reading and citation alongside the analysis. The registered
          instrument at the official source remains authoritative.{" "}
          <a href={`/tracker/${entryId}/legacy#source-documents`} className="text-fg-3 underline underline-offset-2 hover:text-accent">
            Manage sources
          </a>
        </p>
      </div>
    </div>
  );
}

// Keep complete source text available in manageable reading pages.
function PageBody({ text, page }: { text: string; page: Page }) {
  return <div className="text-[16px] leading-[1.8] text-fg-2"><Blocks text={text.slice(page.start, page.end)} /></div>;
}

function Blocks({ text, inline = false }: { text: string; inline?: boolean }) {
  if (inline) return <>{text}</>;

  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let buffer: string[] = [];

  const flush = (key: string) => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (!body) return;
    out.push(
      <p key={key} className="mb-3.5 whitespace-pre-wrap break-words last:mb-0">
        {body}
      </p>
    );
  };

  lines.forEach((line, i) => {
    const heading = /^(#{2,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush(`p-${i}`);
      const level = heading[1].length;
      out.push(
        <h3
          key={`h-${i}`}
          className={
            level <= 4
              ? "mb-3 mt-7 text-[15px] font-semibold tracking-[-0.01em] text-fg first:mt-0"
              : "mb-2 mt-5 font-mono text-[12px] uppercase tracking-[0.05em] text-fg-3 first:mt-0"
          }
        >
          {heading[2]}
        </h3>
      );
      return;
    }
    buffer.push(line);
  });
  flush("p-end");

  return <>{out}</>;
}

function Pager({
  pageIndex,
  pageCount,
  onChange,
}: {
  pageIndex: number;
  pageCount: number;
  onChange: (next: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-4 flex items-center justify-between">
      <button
        type="button"
        disabled={pageIndex === 0}
        onClick={() => onChange(pageIndex - 1)}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-mono text-[12px] text-fg-2 transition-colors hover:border-border-hover hover:text-fg disabled:opacity-35"
      >
        <ChevronLeft className="h-3 w-3" /> Previous
      </button>

      <span className="font-mono text-[11px] uppercase tracking-[0.06em] tabular-nums text-fg-3">
        Page {pageIndex + 1} of {pageCount}
      </span>

      <button
        type="button"
        disabled={pageIndex >= pageCount - 1}
        onClick={() => onChange(pageIndex + 1)}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-mono text-[12px] text-fg-2 transition-colors hover:border-border-hover hover:text-fg disabled:opacity-35"
      >
        Next <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// Part headings in compilations trail their divisions onto the same line
// ("Part IIIA—Credit reporting Division 1—Introduction"). Keep the part.
function shortHeading(text: string): string {
  const divisionAt = text.search(/\s(Division|Subdivision)\s/);
  const base = divisionAt > 0 ? text.slice(0, divisionAt) : text;
  return base.length > 46 ? `${base.slice(0, 45)}…` : base;
}
