"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, Loader2 } from "lucide-react";
import { useKnowledgeItem } from "@/hooks/use-knowledge";
import { ArtifactDocument } from "@/components/library/artifact-document";

export default function BriefingPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useKnowledgeItem(id);

  return (
    <div className="min-h-screen bg-[#EDE8E1] py-10">
      {/* Toolbar — hidden when printing */}
      <div className="no-print mx-auto mb-6 flex max-w-3xl items-center justify-between px-6">
        <Link
          href={`/library/briefings/${id}`}
          className="inline-flex items-center gap-1.5 text-[12px] text-[#5C5A56] transition-colors hover:text-[#2D2B28]"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to briefing
        </Link>
        <button
          onClick={() => window.print()}
          disabled={isLoading || !data?.item}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D97757] px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Printer className="h-3.5 w-3.5" />
          Save as PDF
        </button>
      </div>

      {/* Paper */}
      <div className="artifact-paper mx-auto max-w-3xl rounded-xl px-10 py-10 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.06)]">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : data?.item ? (
          <ArtifactDocument item={data.item} />
        ) : (
          <p className="py-20 text-center text-[14px] text-fg-3">Briefing not found.</p>
        )}
      </div>
    </div>
  );
}
