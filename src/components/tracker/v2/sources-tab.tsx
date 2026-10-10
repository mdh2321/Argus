"use client";

// Sources — the evidence set behind the analysis.
//
// Kept close to v1's behaviour (it was already the strongest part of the page)
// but split primary from supporting up front, and states each document's
// retrieval state in words rather than a badge cluster.

import { ExternalLink, FileText, ShieldCheck, ShieldAlert } from "lucide-react";
import type { SourceDocument, SourceAuthority } from "@/lib/types";
import { formatDate, relativeTime } from "@/lib/utils";
import { openEvidence } from "@/components/evidence/evidence-panel";

const AUTHORITY_LABEL: Record<SourceAuthority, string> = {
  official_legislation: "Official legislation",
  official_regulator: "Official regulator",
  law_firm_analysis: "Law firm analysis",
  news: "News",
  academic: "Academic",
  unknown: "Unclassified",
};

export function SourcesTab({
  documents,
}: {
  documents: SourceDocument[] | undefined;
}) {
  const docs = documents ?? [];
  const primary = docs.filter((d) => d.role === "primary_text");
  const supporting = docs.filter((d) => d.role !== "primary_text");

  if (documents === undefined) return <p role="status" className="py-8 text-fg-3">Source documents are not yet available.</p>;

  if (docs.length === 0) {
    return (
      <div className="max-w-2xl rounded-xl border border-border bg-surface px-5 py-8 text-center">
        <FileText className="mx-auto mb-3 h-5 w-5 text-fg-3" />
        <p className="text-[15px] text-fg-2">No sources attached.</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-fg-3">
          Attach the official instrument text to check the analysis against its source.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-9">
      <Group
        label="The instrument"
        note="The ground-truth legal text this analysis is measured against."
        docs={primary}
        emptyNote="No primary text designated. Use Manage sources to designate the instrument’s primary text."
      />
      {supporting.length > 0 && (
        <Group
          label="Supporting materials"
          note="Guidance, commentary and reporting used to interpret the instrument."
          docs={supporting}
          />
      )}
    </div>
  );
}

function Group({
  label,
  note,
  docs,
  emptyNote,
}: {
  label: string;
  note: string;
  docs: SourceDocument[];
  emptyNote?: string;
}) {
  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">{label}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-fg-3">{note}</p>
      {docs.length === 0 ? (
        emptyNote && <p className="mt-3 text-[14px] text-fg-3">{emptyNote}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {docs.map((doc) => (
            <SourceRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceRow({ doc }: { doc: SourceDocument }) {
  const hasText = !!doc.fullText;
  const authority = AUTHORITY_LABEL[doc.sourceAuthority ?? "unknown"];

  // One sentence on retrieval state, rather than a row of status chips.
  const state = !hasText
    ? "Linked only — no text extracted, so claims cannot be verified against it."
    : doc.fetchStatus === "fetch_failed"
      ? `Text held, but the last re-fetch failed${doc.fetchError ? ` (${doc.fetchError})` : ""}.`
      : doc.lastUrlCheck
        ? `Text extracted · checked ${relativeTime(doc.lastUrlCheck)}`
        : doc.retrievedAt
          ? `Text extracted · retrieved ${formatDate(doc.retrievedAt)}`
          : "Text extracted.";

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 py-3.5">
      <span className="mt-0.5">
        {hasText ? (
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--green-text)]" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 text-fg-3" />
        )}
      </span>

      <div className="min-w-0">
        <div className="text-[16px] font-medium leading-snug text-fg">{doc.name}</div>
        <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.05em] text-fg-3">
          {authority}
          {doc.charCount ? ` · ${doc.charCount.toLocaleString()} chars` : ""}
        </div>
        <p className="mt-1 text-[14px] leading-relaxed text-fg-3">{state}</p>
      </div>

      <div className="flex flex-shrink-0 items-start gap-3">
        {hasText && (
          <button
            type="button"
            onClick={() => {
              openEvidence({ documentId: doc.id });
            }}
            className="font-mono text-[12px] text-accent transition-colors hover:text-accent-2"
          >
            Read
          </button>
        )}
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[12px] text-fg-3 transition-colors hover:text-accent"
          >
            Source <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </li>
  );
}
