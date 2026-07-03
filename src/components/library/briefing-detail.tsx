"use client";

import Link from "next/link";
import { ArrowLeft, Calendar, Database, BookOpen, CheckCircle2, Loader2, ShieldCheck, Printer } from "lucide-react";
import { ConfidenceBadge, GroundingBar } from "@/components/ui/confidence-badge";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { AgentBadge } from "@/components/ui/agent-badge";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { briefingToMarkdown } from "@/lib/markdown-export";
import { useKnowledgeItem, verifyKnowledgeItem } from "@/hooks/use-knowledge";
import { TopicMarkdown } from "@/components/library/topic-markdown";
import { useState } from "react";
import type { BriefingContent, BriefingItem, KnowledgeConfidence } from "@/lib/types";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const authorityLabel: Record<string, string> = {
  official_legislation: "Official legislation",
  official_regulator: "Regulator",
  law_firm_analysis: "Law firm",
  news: "News",
  mixed: "Mixed sources",
};

function ClaimConfidenceDot({ confidence }: { confidence: KnowledgeConfidence }) {
  const color = confidence === "high" ? "var(--green)" : confidence === "medium" ? "var(--amber)" : "var(--red)";
  return (
    <span
      className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 mt-[6px]"
      style={{ backgroundColor: color }}
      title={`${confidence} confidence`}
    />
  );
}

function BriefingSectionView({ heading, items }: { heading: string; items: BriefingItem[] }) {
  return (
    <section className="mb-8">
      <h3 className="label-mono mb-3" style={{ color: "var(--accent)" }}>{heading}</h3>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <ClaimConfidenceDot confidence={item.confidence} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-fg leading-relaxed">{item.claim}</p>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-fg-3 font-mono">
                {item.entryName && (
                  <Link
                    href={`/tracker/${item.entryId}`}
                    className="hover:text-accent transition-colors"
                  >
                    {item.entryName}
                  </Link>
                )}
                {item.sourceSection && (
                  <span>{item.sourceSection}</span>
                )}
                {item.sourceAuthority && (
                  <span className="opacity-60">{authorityLabel[item.sourceAuthority] || item.sourceAuthority}</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BriefingDetail({ id }: { id: string }) {
  const { data, isLoading, mutate } = useKnowledgeItem(id);
  const [verifying, setVerifying] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-fg-3" />
      </div>
    );
  }

  if (!data?.item) {
    return (
      <div className="text-center py-20 text-fg-3">
        <p>Briefing not found.</p>
        <Link href="/library" className="text-accent hover:underline mt-2 inline-block text-[13px]">
          Back to briefings
        </Link>
      </div>
    );
  }

  const item = data.item;
  let briefingContent: BriefingContent | null = null;
  try {
    briefingContent = JSON.parse(item.content);
  } catch { /* fallback to raw content */ }

  async function handleVerify() {
    setVerifying(true);
    try {
      await verifyKnowledgeItem(id);
      mutate();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="anim-enter">
      {/* Back link */}
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg-2 transition-colors mb-6"
      >
        <ArrowLeft className="w-3 h-3" />
        Briefings
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-[22px] font-bold text-fg tracking-[-0.02em]">{item.title}</h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ConfidenceBadge confidence={item.confidence} size="md" />
            <CopyMarkdownButton getMarkdown={() => briefingToMarkdown(item)} />
            <Link
              href={`/print/briefings/${id}`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-mono text-fg-3 hover:text-accent hover:border-accent/30 transition-colors"
              title="Open a print-ready document to save as PDF"
            >
              <Printer className="w-3 h-3" strokeWidth={1.5} />
              PDF
            </Link>
            {!item.lastVerified && (
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-mono text-fg-3 hover:text-green hover:border-green/30 transition-colors disabled:opacity-50"
              >
                {verifying ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3 h-3" strokeWidth={1.5} />
                )}
                Verify
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[12px] text-fg-3">
          {item.periodFrom && item.periodTo && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" strokeWidth={1.5} />
              {formatDate(item.periodFrom)} — {formatDate(item.periodTo)}
            </span>
          )}
          {item.jurisdiction && <JurisdictionBadge code={item.jurisdiction} showName />}
          <AgentBadge workflow="briefing" timestamp={item.lastGenerated || item.updatedAt} />
          {item.lastVerified && (
            <span className="flex items-center gap-1" style={{ color: "var(--green)" }}>
              <CheckCircle2 className="w-3 h-3" />
              Verified {formatDate(item.lastVerified)}
            </span>
          )}
        </div>
      </div>

      {/* Trust summary bar */}
      {briefingContent && (
        <div className="rounded-xl border border-border bg-bg-surface p-4 mb-8">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-5 text-[12px] text-fg-3 font-mono">
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" strokeWidth={1.5} />
                {briefingContent.entryCount} entries
              </span>
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
                {briefingContent.digestCount} digest stories
              </span>
              <span>{briefingContent.sourceDocCount} source docs</span>
            </div>
            <div className="flex items-center gap-2 min-w-[160px]">
              <span className="text-[10px] text-fg-3 font-mono whitespace-nowrap">Grounding</span>
              <GroundingBar ratio={briefingContent.groundingRatio} size="md" />
            </div>
          </div>
        </div>
      )}

      {/* Briefing sections (structured JSON) or, for shelf artifacts like
          pinned answers and comparison tables, the stored markdown rendered
          with the shared renderer (headings, bold, GFM tables). */}
      {briefingContent?.sections ? (
        briefingContent.sections.map((section, i) => (
          <BriefingSectionView key={i} heading={section.heading} items={section.items} />
        ))
      ) : (
        <div className="rounded-xl border border-border bg-surface p-6">
          <TopicMarkdown content={item.content} />
        </div>
      )}

      {/* Claims audit trail */}
      {item.claims && item.claims.length > 0 && (
        <section className="mt-10 pt-8 border-t border-border">
          <h3 className="label-mono mb-4">Claim Audit Trail</h3>
          <p className="text-[12px] text-fg-3 mb-4">
            {item.claimCount} claims total — {item.groundedClaimCount} grounded in sources ({Math.round(item.groundingRatio * 100)}%)
          </p>
          <div className="space-y-2">
            {item.claims.map((claim) => (
              <div
                key={claim.id}
                className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-[12px]"
              >
                <ClaimConfidenceDot confidence={claim.confidence} />
                <div className="min-w-0 flex-1">
                  <p className="text-fg-2">{claim.claimText}</p>
                  <div className="flex items-center gap-2 mt-1 font-mono text-[10px] text-fg-3">
                    <span className={
                      claim.groundingType === "ai_knowledge" ? "text-red" :
                      claim.groundingType === "direct_quote" ? "text-green" :
                      "text-fg-3"
                    }>
                      {claim.groundingType.replace("_", " ")}
                    </span>
                    {claim.sourceSection && <span>{claim.sourceSection}</span>}
                    {claim.sourceEntryId && (
                      <Link href={`/tracker/${claim.sourceEntryId}`} className="hover:text-accent">
                        entry &rarr;
                      </Link>
                    )}
                    {claim.disputed && (
                      <span className="text-red">DISPUTED: {claim.disputeNote}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
