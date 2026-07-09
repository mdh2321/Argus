import Link from "next/link";
import { Calendar, Database, BookOpen, FileText } from "lucide-react";
import { ArgusLogo } from "@/components/ui/argus-logo";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { GroundingBar } from "@/components/ui/confidence-badge";
import type { BriefingContent, BriefingItem, KnowledgeConfidence, KnowledgeItem } from "@/lib/types";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const confidenceColor: Record<KnowledgeConfidence, string> = {
  high: "var(--green)",
  medium: "var(--amber)",
  low: "var(--red)",
  unverified: "var(--fg-3)",
};

function ConfidenceDot({ confidence }: { confidence: KnowledgeConfidence }) {
  return (
    <span
      className="mt-[6px] inline-block h-[6px] w-[6px] flex-shrink-0 rounded-full"
      style={{ backgroundColor: confidenceColor[confidence] }}
      title={`${confidence} confidence`}
    />
  );
}

function Section({ heading, items }: { heading: string; items: BriefingItem[] }) {
  return (
    <section className="mb-7 break-inside-avoid">
      <h3 className="label-mono mb-3" style={{ color: "var(--accent)" }}>{heading}</h3>
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <ConfidenceDot confidence={item.confidence} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-relaxed text-fg">{item.claim}</p>
              {(item.entryName || item.sourceSection) && (
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-fg-3">
                  {item.entryName && (
                    <Link href={`/tracker/${item.entryId}`} className="hover:text-accent transition-colors">
                      {item.entryName}
                    </Link>
                  )}
                  {item.sourceSection && <span>{item.sourceSection}</span>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Unique cited tracker entries across the briefing, for the sources appendix. */
function citedEntries(content: BriefingContent): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const section of content.sections) {
    for (const item of section.items) {
      if (item.entryId && item.entryName && !seen.has(item.entryId)) {
        seen.set(item.entryId, item.entryName);
      }
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * The polished, document-grade rendering of an artifact (currently briefings).
 * Used both inside the app and on the print/PDF route. Self-contained and
 * presentational — pass a KnowledgeItem and it renders the branded document.
 */
export function ArtifactDocument({ item, docType = "Regulatory Update" }: { item: KnowledgeItem; docType?: string }) {
  let content: BriefingContent | null = null;
  try {
    content = JSON.parse(item.content) as BriefingContent;
  } catch {
    /* non-structured content falls back to plain text below */
  }

  const sources = content ? citedEntries(content) : [];

  return (
    <article className="text-fg">
      {/* Branded header */}
      <header className="mb-7 border-b border-border pb-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArgusLogo size={20} className="text-fg" />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Argus</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-3">
            <FileText className="h-3 w-3" />
            {docType}
          </span>
        </div>

        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-fg">{item.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-3">
          {item.periodFrom && item.periodTo && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3" strokeWidth={1.5} />
              {formatDate(item.periodFrom)} — {formatDate(item.periodTo)}
            </span>
          )}
          {item.jurisdiction && <JurisdictionBadge code={item.jurisdiction} showName />}
          <span
            className="font-mono uppercase tracking-[0.04em]"
            style={{ color: confidenceColor[item.confidence] }}
          >
            {item.confidence} confidence
          </span>
          {item.lastGenerated && <span>Generated {formatDate(item.lastGenerated)}</span>}
        </div>
      </header>

      {/* Trust bar */}
      {content && (
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-5 font-mono text-[12px] text-fg-3">
            <span className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" strokeWidth={1.5} />
              {content.entryCount} laws
            </span>
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
              {content.digestCount} stories
            </span>
            <span>{content.sourceDocCount} source docs</span>
          </div>
          <div className="flex min-w-[160px] items-center gap-2">
            <span className="whitespace-nowrap font-mono text-[10px] text-fg-3">Grounding</span>
            <GroundingBar ratio={content.groundingRatio} size="md" />
          </div>
        </div>
      )}

      {/* Body */}
      {content?.sections?.length ? (
        content.sections.map((section, i) => <Section key={i} heading={section.heading} items={section.items} />)
      ) : (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg-2">{item.content}</p>
      )}

      {/* Sources appendix */}
      {sources.length > 0 && (
        <section className="mt-8 break-inside-avoid border-t border-border pt-5">
          <h3 className="label-mono mb-3">Sources</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {sources.map((s) => (
              <li key={s.id} className="text-[12px] text-fg-2">
                <Link href={`/tracker/${s.id}`} className="hover:text-accent transition-colors">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-border pt-4 font-mono text-[10px] text-fg-3">
        Generated by Argus{item.lastGenerated ? ` · ${formatDate(item.lastGenerated)}` : ""} ·{" "}
        {Math.round((item.groundingRatio || 0) * 100)}% of claims grounded in sources
      </footer>
    </article>
  );
}
