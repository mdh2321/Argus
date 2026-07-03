"use client";

import Link from "next/link";
import type { DigestStoryReference } from "@/hooks/use-digest";
import { UnmatchedReferencePopover } from "./unmatched-reference-popover";

type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; reference: DigestStoryReference; text: string };

type Paragraph = Segment[];

interface Props {
  summary: string;
  references: DigestStoryReference[];
  expanded: boolean;
}

export function StorySummary({ summary, references, expanded }: Props) {
  const paragraphs = buildParagraphs(summary, references);

  return (
    <div className="mt-2 space-y-3">
      {paragraphs.map((paragraph, i) => (
        <p
          key={i}
          className={`text-[15px] leading-relaxed text-fg-2 ${
            !expanded && i === 0 ? "line-clamp-2" : ""
          } ${!expanded && i > 0 ? "hidden" : ""}`}
        >
          {paragraph.map((seg, j) => {
            if (seg.type === "text") return <span key={j}>{seg.text}</span>;
            return <ReferenceMark key={j} segment={seg} />;
          })}
        </p>
      ))}
    </div>
  );
}

function ReferenceMark({
  segment,
}: {
  segment: Extract<Segment, { type: "ref" }>;
}) {
  const { reference, text } = segment;

  if (reference.status === "matched" && reference.entryId) {
    return (
      <Link
        href={`/tracker/${reference.entryId}`}
        onClick={(e) => e.stopPropagation()}
        className="text-accent underline decoration-accent/40 decoration-1 underline-offset-2 transition-colors hover:decoration-accent"
        title={
          reference.proposedShortName
            ? `Tracked: ${reference.proposedShortName}`
            : "Tracked"
        }
      >
        {text}
      </Link>
    );
  }

  if (reference.status === "unmatched") {
    return (
      <UnmatchedReferencePopover
        reference={reference}
        trigger={
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="text-fg-2 underline decoration-fg-3 decoration-dotted decoration-1 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent/60"
            title={
              reference.proposedShortName
                ? `Add to tracker: ${reference.proposedShortName}`
                : "Add to tracker"
            }
          >
            {text}
          </button>
        }
      />
    );
  }

  // dismissed or anything else — render plain
  return <span>{text}</span>;
}

// ─── Segmentation ─────────────────────────────────────────────────────────────

function buildParagraphs(summary: string, references: DigestStoryReference[]): Paragraph[] {
  const refs = [...references]
    .filter((r) => r.charEnd > r.charStart && r.charEnd <= summary.length)
    .sort((a, b) => a.charStart - b.charStart);

  // Drop overlapping refs (keep the earlier one) so the renderer doesn't split mid-token.
  const safe: DigestStoryReference[] = [];
  let lastEnd = -1;
  for (const r of refs) {
    if (r.charStart < lastEnd) continue;
    safe.push(r);
    lastEnd = r.charEnd;
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const ref of safe) {
    if (ref.charStart > cursor) {
      segments.push({ type: "text", text: summary.slice(cursor, ref.charStart) });
    }
    segments.push({
      type: "ref",
      reference: ref,
      text: summary.slice(ref.charStart, ref.charEnd),
    });
    cursor = ref.charEnd;
  }
  if (cursor < summary.length) {
    segments.push({ type: "text", text: summary.slice(cursor) });
  }

  // Split text segments on \n into paragraphs.
  const paragraphs: Paragraph[] = [[]];
  for (const seg of segments) {
    if (seg.type === "text") {
      const parts = seg.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].length > 0) {
          paragraphs[paragraphs.length - 1].push({ type: "text", text: parts[i] });
        }
        if (i < parts.length - 1) paragraphs.push([]);
      }
    } else {
      paragraphs[paragraphs.length - 1].push(seg);
    }
  }

  return paragraphs.filter((p) => p.length > 0);
}
