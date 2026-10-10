"use client";

// The reading view. Editing and source management remain available under /legacy.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MoreHorizontal, Sparkles, Eye, Pencil, Flag, FileDown, Archive } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";

import { useEntry, updateEntry, deleteEntry } from "@/hooks/use-entries";
import { openEvidence } from "@/components/evidence/evidence-panel";
import { useDocuments } from "@/hooks/use-documents";
import { ENTRY_TYPES } from "@/lib/constants";
import { entryToMarkdown } from "@/lib/markdown-export";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";

import { OverviewTab } from "@/components/tracker/v2/overview-tab";
import { AnalysisTab } from "@/components/tracker/v2/analysis-tab";
import { TimelineTab } from "@/components/tracker/v2/timeline-tab";
import { InstrumentReader } from "@/components/tracker/v2/instrument-reader";
import { SourcesTab } from "@/components/tracker/v2/sources-tab";
import { FactRail } from "@/components/tracker/v2/fact-rail";
import { BlockingStrip, computeRecordState } from "@/components/tracker/v2/record-state";
import {
  CitationIndexProvider,
} from "@/components/tracker/v2/primitives";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "analysis", label: "Analysis" },
  { id: "timeline", label: "Timeline" },
  { id: "instrument", label: "Instrument" },
  { id: "sources", label: "Sources" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return !!value && TABS.some((t) => t.id === value);
}

export default function EntryV2Page() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data, mutate, isLoading, error } = useEntry(id);
  const { data: docsData, error: docsError } = useDocuments(id);

  const urlTab = searchParams.get("tab");
  const tab: TabId = isTabId(urlTab) ? urlTab : "overview";
  const selectTab = useCallback((next: TabId) => {
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const revealed = useRef<string | null>(null);
  // Keep older saved Ask links useful without moving the reader off this tab.
  useEffect(() => {
    const documentId = searchParams.get("revealDoc");
    const key = `${id}:${documentId}:${searchParams.get("sectionRef")}`;
    if (documentId && revealed.current !== key) {
      revealed.current = key;
      openEvidence({ documentId, sectionRef: searchParams.get("sectionRef") });
    }
  }, [id, searchParams]);

  const summaryStatus = data?.entry?.summaryStatus ?? "idle";
  const generating = summaryStatus === "running";

  const regenerate = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracker/entries/${id}/generate-summary`, { method: "POST" });
      if (res.status === 202 || res.status === 409) {
        toast.message("Analysis regenerating", {
          description: "Running in the background — the page updates when it finishes.",
        });
        mutate();
        return;
      }
      const body = await res.json().catch(() => ({}));
      toast.error("Couldn't start generation", {
        description: body?.detail || body?.error || `HTTP ${res.status}`,
      });
    } catch (err) {
      toast.error("Couldn't start generation", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [id, mutate]);

  const entry = data?.entry;

  const recordState = useMemo(
    () => (entry ? computeRecordState(entry, docsData?.documents, { onRegenerate: regenerate }) : []),
    [entry, docsData?.documents, regenerate]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!entry || !data) {
    return (
      <div className="anim-enter py-24 text-center">
        <p className="text-[15px] text-fg-3">{error ? "This record couldn’t be loaded. Try refreshing." : "Entry not found"}</p>
        <button
          onClick={() => { const saved = sessionStorage.getItem("argus:tracker-return"); router.push(saved?.startsWith("/tracker?") ? saved : "/tracker"); }}
          className="mt-2 text-[13px] text-accent hover:underline"
        >
          Back to tracker
        </button>
      </div>
    );
  }

  const typeLabel = ENTRY_TYPES.find((t) => t.value === entry.type)?.label ?? entry.type;

  return (
    <div className="anim-enter">
      <button
        onClick={() => { const saved = sessionStorage.getItem("argus:tracker-return"); router.push(saved?.startsWith("/tracker?") ? saved : "/tracker"); }}
        className="mb-7 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-fg-3 transition-colors hover:text-fg-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Tracker
      </button>

      {/* Masthead */}
      <header>
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <JurisdictionBadge code={entry.jurisdiction} showName />
          <span className="text-fg-3 opacity-30">/</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-fg-3">
            {typeLabel}
          </span>
          {entry.regulator && (
            <>
              <span className="text-fg-3 opacity-30">/</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-fg-3">
                {entry.regulator}
              </span>
            </>
          )}
        </div>

        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-[36px] font-medium leading-[1.15] tracking-[-0.035em] text-fg">
              {entry.shortName}
            </h1>
            {entry.formalCitation && (
              <p className="mt-1.5 font-mono text-[12px] text-fg-3">{entry.formalCitation}</p>
            )}
          </div>

          {/* One primary action; everything else behind the overflow. v1 put
              seven buttons in this row. */}
          <div className="flex flex-shrink-0 items-center gap-1">
            <Link
              href={`/ask?scopeKind=entry&scopeId=${entry.id}&scopeLabel=${encodeURIComponent(entry.shortName)}`}
              className="argus-primary"
            >
              <Eye className="h-3 w-3" />
              Ask Argus
            </Link>
            <ActionsMenu
              entryId={entry.id}
              generating={generating}
              flagged={!!entry.flagged}
              onRegenerate={regenerate}
              onToggleFlag={async () => {
                await updateEntry(id, { flagged: !entry.flagged });
                mutate();
              }}
              onCopyMarkdown={async () => {
                await navigator.clipboard.writeText(entryToMarkdown(entry));
                toast.success("Copied as Markdown");
              }}
              onArchive={async () => {
                if (!confirm("Archive this entry?")) return;
                await deleteEntry(id);
                router.push("/tracker");
              }}
            />
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge status={entry.status} />
          <ImpactIndicator score={entry.impactScore} showLabel />
          {generating && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent">
              <Sparkles className="h-3 w-3 animate-spin" />
              Regenerating
            </span>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Entry sections"
        className="mt-7 flex items-end gap-8 border-b border-border"
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const i = TABS.findIndex((t) => t.id === tab);
          const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
          selectTab(TABS[next].id);
          document.getElementById(`tab-${TABS[next].id}`)?.focus();
        }}
      >
        {TABS.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              // Roving tabindex: only the selected tab is in the tab order.
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(t.id)}
              className={`relative -mb-px border-b-2 pb-4 text-[15px] transition-colors ${
                selected
                  ? "border-accent font-medium text-fg"
                  : "border-transparent text-fg-3 hover:text-fg-2"
              }`}
            >
              {t.label}
              {t.id === "sources" && (docsData?.documents?.length ?? 0) > 0 && (
                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-fg-3">
                  {docsData!.documents.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels. Footnote numbers are assigned once for the whole entry so a
          marker keeps its number across tabs and across deep links. */}
      <CitationIndexProvider entry={entry} documents={docsData?.documents}>
      <div className="pt-8">
        {docsError && <p role="alert" className="mb-5 text-amber-text">Source documents couldn’t be loaded. Evidence status is unavailable; try refreshing.</p>}
        <Panel id="overview" tab={tab}>
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="min-w-0 max-w-[46rem]">
              <BlockingStrip
                items={recordState}
                proposedCount={data.proposedChanges?.length ?? 0}
                entryId={entry.id}
              />
              <OverviewTab data={data} />
            </div>
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <FactRail
                data={data}
                documents={docsData?.documents}
                onRegenerate={regenerate}
              />
            </aside>
          </div>
        </Panel>

        <Panel id="analysis" tab={tab}>
          <div className="max-w-[46rem]">
            <AnalysisTab data={data} />
          </div>
        </Panel>

        <Panel id="timeline" tab={tab}>
          <TimelineTab data={data} />
        </Panel>

        <Panel id="instrument" tab={tab}>
          <InstrumentReader documents={docsData?.documents} entryId={entry.id} />
        </Panel>

        <Panel id="sources" tab={tab}>
          <Link href={`/tracker/${entry.id}/legacy#source-documents`} className="argus-secondary mb-6">Manage sources</Link>
          <SourcesTab
            documents={docsData?.documents}
          />
        </Panel>
      </div>
      </CitationIndexProvider>
    </div>
  );
}

function Panel({
  id,
  tab,
  children,
}: {
  id: TabId;
  tab: TabId;
  children: React.ReactNode;
}) {
  if (id !== tab) return null;
  return (
    <div id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}

function ActionsMenu({
  entryId,
  generating,
  flagged,
  onRegenerate,
  onToggleFlag,
  onCopyMarkdown,
  onArchive,
}: {
  entryId: string;
  generating: boolean;
  flagged: boolean;
  onRegenerate: () => void;
  onToggleFlag: () => void;
  onCopyMarkdown: () => void;
  onArchive: () => void;
}) {
  const itemClass =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg-2 outline-none transition-colors data-[highlighted]:bg-hover data-[highlighted]:text-fg";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Entry actions"
          className="rounded-lg border border-transparent p-1.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[13rem] rounded-xl border border-border bg-surface p-1 shadow-xl"
        >
          <DropdownMenu.Item className={itemClass} disabled={generating} onSelect={onRegenerate}>
            <Sparkles className="h-3.5 w-3.5" />
            {generating ? "Regenerating…" : "Regenerate analysis"}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={onCopyMarkdown}>
            <FileDown className="h-3.5 w-3.5" />
            Copy as Markdown
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={itemClass}>
            <Link href={`/tracker/${entryId}/legacy`}>
              <Pencil className="h-3.5 w-3.5" />
              Edit & manage record
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={onToggleFlag}>
            <Flag className="h-3.5 w-3.5" />
            {flagged ? "Remove flag" : "Flag for review"}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={`${itemClass} text-[var(--red)] data-[highlighted]:text-[var(--red)]`}
            onSelect={onArchive}
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
