"use client";

import Link from "next/link";
import { FileText, Calendar, Database } from "lucide-react";
import { ConfidenceBadge, GroundingBar } from "@/components/ui/confidence-badge";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { AgentBadge } from "@/components/ui/agent-badge";
import type { KnowledgeItem, BriefingContent, KnowledgeConfidence } from "@/lib/types";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function BriefingCard({ briefing }: { briefing: KnowledgeItem }) {
  let parsed: BriefingContent | null = null;
  try {
    parsed = JSON.parse(briefing.content);
  } catch { /* not a structured briefing */ }

  const sectionCount = parsed?.sections?.length || 0;
  const itemCount = parsed?.sections?.reduce((sum, s) => sum + s.items.length, 0) || 0;

  return (
    <Link
      href={`/library/briefings/${briefing.id}`}
      className="group block rounded-xl border border-border bg-bg-surface p-5 transition-all duration-200 hover:border-border-hover hover:shadow-card-hover"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-fg-3 flex-shrink-0" strokeWidth={1.5} />
            <h3 className="text-[15px] font-semibold text-fg truncate group-hover:text-accent transition-colors">
              {briefing.title}
            </h3>
          </div>

          <div className="flex items-center gap-3 text-[12px] text-fg-3 mb-3">
            {briefing.periodFrom && briefing.periodTo && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" strokeWidth={1.5} />
                {formatDate(briefing.periodFrom)} — {formatDate(briefing.periodTo)}
              </span>
            )}
            {briefing.jurisdiction && (
              <JurisdictionBadge code={briefing.jurisdiction} />
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px] text-fg-3 font-mono">
            {parsed && (
              <>
                <span>{sectionCount} sections</span>
                <span>{itemCount} items</span>
                <span className="flex items-center gap-1">
                  <Database className="w-3 h-3" strokeWidth={1.5} />
                  {parsed.entryCount} entries, {parsed.digestCount} digest stories
                </span>
              </>
            )}
          </div>

          <div className="mt-3">
            <AgentBadge workflow="briefing" timestamp={briefing.lastGenerated || briefing.updatedAt} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <ConfidenceBadge confidence={briefing.confidence as KnowledgeConfidence} size="sm" />
          <div className="w-24">
            <GroundingBar ratio={briefing.groundingRatio} size="sm" />
          </div>
        </div>
      </div>
    </Link>
  );
}
