"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEntry, updateEntry, deleteEntry } from "@/hooks/use-entries";
import { JurisdictionBadge } from "@/components/ui/jurisdiction-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import { AgentBadge } from "@/components/ui/agent-badge";
import { STATUSES, ENTRY_TYPES, SOURCE_TIERS, CONFIDENCE_LEVELS } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/utils";
import { useState, useRef, useEffect, createContext, useContext, useMemo } from "react";
import {
  ArrowLeft,
  Pencil,
  Flag,
  Trash2,
  Check,
  X,
  ExternalLink,
  Clock,
  Calendar,
  FileText,
  Plus,
  Upload,
  Link2,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  Minus,
  MoreHorizontal,
  Loader2,
  AlertCircle,
  RefreshCw,
  Newspaper,
  Bot,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type {
  Entry,
  EntryClaim,
  EntryRelated,
  RelatedEntryWithKind,
  SectionConfidence,
  SourceAuthority,
  EscalationTrigger,
  ComplianceChecklistItem,
  ThresholdTest,
  ArtifactKind,
} from "@/lib/types";
import { useDocuments, addDocument, deleteDocument, refetchDocument } from "@/hooks/use-documents";
import useSWR from "swr";
import { EntryTOC } from "@/components/tracker/entry-toc";
import { LegislativeTimeline } from "@/components/tracker/legislative-timeline";
import { QuickFacts } from "@/components/tracker/quick-facts";
import { SourceSuggestionPanel } from "@/components/tracker/source-suggestion-panel";
import { ProposedChangesPanel } from "@/components/tracker/proposed-changes-panel";
import { toast } from "sonner";
import { computeTrustBadges } from "@/lib/trust-badges";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { entryToMarkdown } from "@/lib/markdown-export";
import Link from "next/link";

interface EntryNewsStory {
  id: string;
  title: string;
  date: string;
  source: string;
  sourceType: string;
  summary: string;
  url: string | null;
  jurisdictionCode: string | null;
  impact: string | null;
  issueSlug: string | null;
  issueTitle: string | null;
}

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  complianceChecklist: "Compliance checklist",
  thresholdTests: "Threshold tests",
  escalationTriggers: "Escalation triggers",
  crossJurisdictionAnalogues: "Cross-jurisdiction analogues",
};

const SECTION_FIELD_MAP = {
  summary: "summary",
  applicability: "applicability",
  keyCriteria: "keyCriteria",
  whyItMatters: "whyItMatters",
  complianceImplications: "complianceImplications",
  exemptions: "exemptions",
  penalties: "penalties",
  openQuestions: "openQuestions",
  relatedContext: "relatedContext",
} as const;

const SOURCE_AUTHORITY_META: Record<
  SourceAuthority,
  { label: string; color: string; background: string; border: string }
> = {
  official_legislation: {
    label: "Official legislation",
    color: "#22c55e",
    background: "rgba(34, 197, 94, 0.12)",
    border: "rgba(34, 197, 94, 0.28)",
  },
  official_regulator: {
    label: "Official regulator",
    color: "#3b82f6",
    background: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.28)",
  },
  law_firm_analysis: {
    label: "Law firm analysis",
    color: "#8b5cf6",
    background: "rgba(139, 92, 246, 0.12)",
    border: "rgba(139, 92, 246, 0.28)",
  },
  news: {
    label: "News",
    color: "#6b7280",
    background: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.28)",
  },
  academic: {
    label: "Academic",
    color: "#f59e0b",
    background: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.28)",
  },
  unknown: {
    label: "Unclassified",
    color: "#6b7280",
    background: "rgba(107, 114, 128, 0.12)",
    border: "rgba(107, 114, 128, 0.28)",
  },
};

export default function EntryDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data, mutate, isLoading } = useEntry(id);
  const { data: docsData, mutate: mutateDocs } = useDocuments(id);
  const { data: termsData } = useSWR<{
    terms: { id: string; term: string; definition: string; sectionRef: string | null; scope: string }[];
  }>(id ? `/api/tracker/entries/${id}/extract-terms` : null, (url: string) =>
    fetch(url).then((r) => r.json())
  );
  // "In the news" — digest stories that referenced this entry (B3).
  const { data: newsData } = useSWR<{ stories: EntryNewsStory[] }>(
    id ? `/api/tracker/entries/${id}/stories` : null,
    (url: string) => fetch(url).then((r) => r.json())
  );
  const newsStories = newsData?.stories || [];
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Entry>>({});
  const [showDocForm, setShowDocForm] = useState(false);
  const searchParams = useSearchParams();
  const [showSuggestPanel, setShowSuggestPanel] = useState(
    searchParams.get("suggestSources") === "1"
  );

  // If we land here with ?suggestSources=1 (e.g. from the digest popover),
  // open the panel and clean the query param so a refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("suggestSources") === "1") {
      setShowSuggestPanel(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("suggestSources");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);
  const [docForm, setDocForm] = useState({ name: "", sourceUrl: "", fullText: "" });
  const [docUploading, setDocUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The "Generating..." spinner is driven by the entry's persisted summaryStatus,
  // not local state — so the spinner survives page reloads and shows up if a
  // background job is running when the user navigates back to the entry.
  const summaryStatus = data?.entry?.summaryStatus ?? "idle";
  const generating = summaryStatus === "running";

  // Surface a toast when a running generation finishes (success or failure),
  // so the user gets feedback even if they came back to the tab later.
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === "running" && summaryStatus === "idle") {
      toast.success("Summary regenerated");
    } else if (prev === "running" && summaryStatus === "failed") {
      toast.error("Generate Summary failed", {
        description: data?.entry?.summaryError ?? undefined,
        duration: 10000,
      });
    }
    prevStatusRef.current = summaryStatus;
  }, [summaryStatus, data?.entry?.summaryError]);

  // Per-artifact job status. Mirrors the summary-status pattern: persisted on
  // the entry so the spinner survives reloads, polled by SWR while running,
  // toast-on-completion via a previous-state ref.
  const analysisJobs = data?.entry?.analysisJobs ?? null;
  const artifactStatus = (kind: ArtifactKind) =>
    analysisJobs?.[kind]?.status ?? "idle";
  const prevArtifactStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!analysisJobs) return;
    for (const [kind, state] of Object.entries(analysisJobs)) {
      const prev = prevArtifactStatusRef.current[kind];
      const status = state?.status ?? "idle";
      if (prev === "running" && status === "idle") {
        toast.success(`${ARTIFACT_LABEL[kind as ArtifactKind]} ready`);
      } else if (prev === "running" && status === "failed") {
        toast.error(`${ARTIFACT_LABEL[kind as ArtifactKind]} generation failed`, {
          description: state?.error ?? undefined,
          duration: 10000,
        });
      }
      prevArtifactStatusRef.current[kind] = status;
    }
  }, [analysisJobs]);

  const triggerSummary = async () => {
    try {
      const res = await fetch(`/api/tracker/entries/${id}/generate-summary`, { method: "POST" });
      if (res.status === 202 || res.status === 409) {
        toast.message("Summary generation started", {
          description: "Running in the background — this can take several minutes. The page will refresh when it's done.",
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
  };

  const triggerArtifact = async (kind: ArtifactKind) => {
    try {
      const res = await fetch(`/api/tracker/entries/${id}/generate-artifact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (res.status === 202 || res.status === 409) {
        toast.message(`${ARTIFACT_LABEL[kind]} generation started`, {
          description: "Running in the background — the page will refresh when it's done.",
        });
        mutate();
        return;
      }
      const body = await res.json().catch(() => ({}));
      toast.error(`Couldn't start ${ARTIFACT_LABEL[kind]}`, {
        description: body?.detail || body?.error || `HTTP ${res.status}`,
      });
    } catch (err) {
      toast.error(`Couldn't start ${ARTIFACT_LABEL[kind]}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data?.entry) {
    return (
      <div className="py-24 text-center anim-enter">
        <p className="text-[15px] text-fg-3">Entry not found</p>
        <button onClick={() => router.push("/tracker")} className="text-[13px] text-accent hover:underline mt-2">
          Back to tracker
        </button>
      </div>
    );
  }

  const entry = data.entry;
  const changes = data.changes;
  const proposedChanges = data.proposedChanges ?? [];
  const parentEntry: EntryRelated | null = data.parentEntry ?? null;
  // Typed relationship groups, computed by the API from entry_relationships.
  const relatedSubordinates: RelatedEntryWithKind[] = data.relatedSubordinates ?? [];
  const relatedGuidance: RelatedEntryWithKind[] = data.relatedGuidance ?? [];
  const amendmentHistory: RelatedEntryWithKind[] = data.amendmentHistory ?? [];
  const inFlightAmendments: RelatedEntryWithKind[] = data.inFlightAmendments ?? [];
  const supersedes: RelatedEntryWithKind[] = data.supersedes ?? [];
  const supersededBy: RelatedEntryWithKind[] = data.supersededBy ?? [];

  // Outside edit mode, sections only render when they have something to
  // show. A section "has content" if its prose field is non-empty OR its
  // claims array is non-empty. Some sections also gate on a structured
  // artifact (checklist / threshold tests / escalation triggers) — those
  // use hasArtifact.
  type ProseField =
    | "summary" | "applicability" | "keyCriteria" | "whyItMatters"
    | "complianceImplications" | "exemptions" | "penalties"
    | "openQuestions" | "relatedContext";
  const hasContent = (field: ProseField): boolean => {
    if (entry[field]) return true;
    const claims = entry.sectionClaims?.[field];
    return !!(claims && claims.length > 0);
  };
  // Dual impact lenses live outside the claims machinery — plain truthiness.
  const hasImpactLens = !!(entry.impactOnUs || entry.impactOnCustomers);
  const hasArtifact = (kind: ArtifactKind): boolean => {
    if (kind === "complianceChecklist")
      return !!(entry.complianceChecklist && entry.complianceChecklist.length > 0);
    if (kind === "thresholdTests")
      return !!(entry.thresholdTests && entry.thresholdTests.length > 0);
    if (kind === "escalationTriggers")
      return !!(entry.escalationTriggers && entry.escalationTriggers.length > 0);
    return !!entry.relatedContext;
  };

  // Used by the Get-started panel to decide whether the entry is "empty
  // enough" to warrant the empty-state UX. Considers analytical content
  // only — key dates / source documents alone don't count, since they don't
  // help the reader understand the law.
  const hasAnyContent =
    hasContent("summary") || hasContent("applicability") || hasContent("keyCriteria") ||
    hasContent("whyItMatters") || hasImpactLens || hasContent("complianceImplications") ||
    hasContent("exemptions") || hasContent("penalties") || hasContent("openQuestions") ||
    hasContent("relatedContext") ||
    hasArtifact("complianceChecklist") || hasArtifact("thresholdTests") ||
    hasArtifact("escalationTriggers");

  // TOC — list of section anchors that are actually rendered. Mirrors the
  // gating logic above so the right rail only lists sections that exist on
  // the current page. In edit mode every section renders, so the TOC shows
  // them all. Order matches the body for scroll-spy correctness.
  const tocSections: { id: string; label: string }[] = [];
  if (editing || hasContent("summary")) tocSections.push({ id: "summary", label: "Summary" });
  if (editing || hasContent("applicability") || hasContent("exemptions"))
    tocSections.push({ id: "applicability", label: "Applicability" });
  if (editing || hasContent("keyCriteria") || hasArtifact("thresholdTests"))
    tocSections.push({ id: "key-criteria", label: "Key criteria" });
  if (editing || hasContent("whyItMatters") || hasImpactLens) tocSections.push({ id: "business-impact", label: "Business impact" });
  if (editing || hasContent("complianceImplications") || hasArtifact("complianceChecklist"))
    tocSections.push({ id: "required-actions", label: "Required actions" });
  if (editing || hasContent("penalties")) tocSections.push({ id: "penalties", label: "Penalties" });
  if (editing || hasContent("openQuestions") || hasArtifact("escalationTriggers") || entry.notes)
    tocSections.push({ id: "notes-watch", label: "Notes & watch items" });
  if (entry.keyDates && entry.keyDates.length > 0)
    tocSections.push({ id: "timeline", label: "Timeline" });
  if (newsStories.length > 0)
    tocSections.push({ id: "in-the-news", label: "In the news" });
  tocSections.push({ id: "source-documents", label: "Source documents" });
  if (changes && changes.length > 0)
    tocSections.push({ id: "change-history", label: "Change history" });
  if (editing || hasContent("relatedContext"))
    tocSections.push({ id: "cross-jurisdiction", label: "Cross-jurisdiction" });
  if (relatedSubordinates.length > 0)
    tocSections.push({ id: "subordinate-instruments", label: "Subordinate instruments" });
  if (relatedGuidance.length > 0)
    tocSections.push({ id: "guidance", label: "Guidance" });
  if (inFlightAmendments.length > 0)
    tocSections.push({ id: "in-flight", label: "In-flight amendments" });
  if (amendmentHistory.length > 0)
    tocSections.push({ id: "amendment-history", label: "Amendment history" });
  if (supersededBy.length > 0 || supersedes.length > 0)
    tocSections.push({ id: "version-chain", label: "Version chain" });

  const startEditing = () => {
    setEditData({
      status: entry.status, shortName: entry.shortName, fullName: entry.fullName,
      formalCitation: entry.formalCitation,
      summary: entry.summary, applicability: entry.applicability, keyCriteria: entry.keyCriteria,
      whyItMatters: entry.whyItMatters, complianceImplications: entry.complianceImplications,
      impactOnUs: entry.impactOnUs, impactOnCustomers: entry.impactOnCustomers,
      exemptions: entry.exemptions, penalties: entry.penalties,
      impactScore: entry.impactScore, regulator: entry.regulator,
      notes: entry.notes, openQuestions: entry.openQuestions, relatedContext: entry.relatedContext,
    });
    setEditing(true);
  };

  const save = async () => {
    const nextClaims = { ...(entry.sectionClaims ?? {}) };
    const nextConfidence = { ...(entry.sectionConfidence ?? {}) };
    let claimsChanged = false;
    let confidenceChanged = false;

    for (const [sectionKey, fieldKey] of Object.entries(SECTION_FIELD_MAP)) {
      const newValue = editData[fieldKey as keyof Entry];
      if (newValue === undefined) continue;
      if (newValue !== entry[fieldKey as keyof Entry]) {
        delete nextClaims[sectionKey as keyof typeof SECTION_FIELD_MAP];
        delete nextConfidence[sectionKey as keyof typeof SECTION_FIELD_MAP];
        claimsChanged = true;
        confidenceChanged = true;
      }
    }

    const payload: Partial<Entry> = { ...editData };
    if (claimsChanged) {
      payload.sectionClaims = Object.keys(nextClaims).length > 0 ? nextClaims : null;
    }
    if (confidenceChanged) {
      payload.sectionConfidence = Object.keys(nextConfidence).length > 0 ? nextConfidence : null;
    }

    await updateEntry(id, payload);
    setEditing(false);
    mutate();
  };

  const toggleFlag = async () => {
    await updateEntry(id, { flagged: !entry.flagged } as Partial<Entry>);
    mutate();
  };

  const archive = async () => {
    if (!confirm("Archive this entry?")) return;
    await deleteEntry(id);
    router.push("/tracker");
  };

  return (
    <DefinedTermsContext.Provider value={termsData?.terms ?? []}>
    <div className="flex items-start anim-enter">
    <article className="max-w-2xl flex-1 min-w-0">
      {/* Back */}
      <button
        onClick={() => router.push("/tracker")}
        className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] uppercase text-fg-3 hover:text-fg-2 mb-8 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Tracker
      </button>

      {/* Masthead */}
      <header className="mb-10">
        {/* Parent Act link */}
        {parentEntry && (
          <Link
            href={`/tracker/${parentEntry.id}`}
            className="inline-flex items-center gap-1.5 mb-4 px-3 py-1.5 bg-surface border border-border rounded-lg text-[12px] text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="text-fg-3">Parent Act:</span>
            <span className="font-medium">{parentEntry.shortName}</span>
          </Link>
        )}

        {/* Meta line */}
        <div className="flex items-center gap-2.5 mb-3">
          <JurisdictionBadge code={entry.jurisdiction} showName />
          <span className="text-fg-3 opacity-30">/</span>
          <span className="font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3">{ENTRY_TYPES.find((t) => t.value === entry.type)?.label}</span>
          <span className="text-fg-3 opacity-30">/</span>
          <span className="font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3">{entry.regulator}</span>
        </div>

        {/* Title */}
        {editing ? (
          <div className="space-y-2">
            <input
              value={editData.shortName || ""}
              onChange={(e) => setEditData({ ...editData, shortName: e.target.value })}
              className="text-[24px] font-semibold tracking-[-0.02em] bg-surface border border-border rounded-xl px-4 py-2 text-fg w-full focus:outline-none focus:shadow-[var(--shadow-m)] transition-all"
            />
            <input
              value={editData.formalCitation || ""}
              onChange={(e) => setEditData({ ...editData, formalCitation: e.target.value })}
              placeholder="Formal citation (e.g. Privacy Act 1988 (Cth))"
              className="font-mono text-[12px] bg-surface border border-border rounded-lg px-3 py-1.5 text-fg w-full focus:outline-none focus:border-border-hover transition-all"
            />
          </div>
        ) : (
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-fg leading-snug">
            {entry.shortName}
          </h1>
        )}
        {!editing && entry.formalCitation && (
          <p className="font-mono text-[12px] text-fg-3 mt-1.5">{entry.formalCitation}</p>
        )}
        <p className="text-[14px] text-fg-3 mt-1.5">{entry.fullName}</p>

        {/* Status + impact + actions */}
        <div className="flex items-center gap-3 mt-4">
          {editing ? (
            <select
              value={editData.status || ""}
              onChange={(e) => setEditData({ ...editData, status: e.target.value })}
              className="px-3 py-1.5 bg-surface border border-border rounded-xl text-[12px] text-fg focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          ) : (
            <StatusBadge status={entry.status} />
          )}
          <ImpactIndicator score={entry.impactScore} showLabel />
          {computeTrustBadges(entry).map((badge) => (
            <span
              key={badge.label}
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          ))}
          {entry.flagged && (
            <span
              title="Flagged for review"
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--amber)]/30 bg-[var(--amber-bg)] px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--amber)]"
            >
              <Flag className="w-2.5 h-2.5" fill="currentColor" />
              Flagged
            </span>
          )}

          <div className="flex-1" />

          {editing ? (
            <div className="flex gap-1.5">
              <button onClick={save} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-[12px] font-medium rounded-lg transition-colors hover:bg-accent-2">
                <Check className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-fg-3 text-[12px] rounded-lg hover:bg-hover transition-colors">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5 items-center">
              <CopyMarkdownButton getMarkdown={() => entryToMarkdown(entry)} />
              <Link
                href={`/ask?scopeKind=entry&scopeId=${entry.id}&scopeLabel=${encodeURIComponent(entry.shortName)}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium font-mono rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                title="Ask Sentinel about this record, grounded in its source"
              >
                <Bot className="w-3 h-3" />
                Ask about this
              </Link>
              <button
                disabled={generating}
                onClick={triggerSummary}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium font-mono rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                <Sparkles className={`w-3 h-3 ${generating ? "animate-spin" : ""}`} />
                {generating ? "Generating…" : entry.summary ? "Regenerate summary" : "Generate Summary"}
              </button>
              <ToolsMenu
                artifactPresent={{
                  complianceChecklist: !!(entry.complianceChecklist && entry.complianceChecklist.length > 0),
                  thresholdTests: !!(entry.thresholdTests && entry.thresholdTests.length > 0),
                  escalationTriggers: !!(entry.escalationTriggers && entry.escalationTriggers.length > 0),
                  crossJurisdictionAnalogues: !!entry.relatedContext,
                }}
                artifactStatus={artifactStatus}
                flagged={!!entry.flagged}
                onArtifact={triggerArtifact}
                onSuggestSources={() => setShowSuggestPanel(true)}
                onEdit={startEditing}
                onToggleFlag={toggleFlag}
                onArchive={archive}
              />
            </div>
          )}
        </div>
      </header>

      {/* Body — flows like a document. In edit mode we render every section
          unconditionally so the user can fill in empty fields. Otherwise we
          hide sections that have nothing to show, so a thin entry doesn't
          drown the reader in "no X recorded yet" placeholders. */}
      <div className="space-y-8 text-[14px] leading-relaxed text-fg-2">
        {/* Preliminary-summary banner — flagged when the most recent summary
            ran without source documents, so the analysis is AI-knowledge
            only. Offers the two paths to upgrade: add docs (then regenerate)
            or suggest sources (then add → regenerate). */}
        {entry.summaryDepth === "preliminary" && hasAnyContent && !editing && (
          <PreliminaryBanner
            onSuggestSources={() => setShowSuggestPanel(true)}
            onAddSource={() => setShowDocForm(true)}
            hasDocs={!!(docsData?.documents && docsData.documents.length > 0)}
            onRegenerate={triggerSummary}
            regenerating={generating}
          />
        )}

        {/* Proposed changes (A1) — digest-sourced updates awaiting approval. */}
        {!editing && proposedChanges.length > 0 && (
          <ProposedChangesPanel proposals={proposedChanges} onResolved={() => mutate()} />
        )}

        {(editing || hasContent("summary")) && (
          <Section id="summary" variant="primary" title="Summary" editing={editing} confidence={entry.sectionConfidence?.summary}
            editEl={<TA value={editData.summary || ""} onChange={(v) => setEditData({ ...editData, summary: v })} rows={6} />}
          >
            <SectionText
              text={entry.summary}
              claims={entry.sectionClaims?.summary}
              emptyState="Summary has not yet been prepared."
            />
          </Section>
        )}

        {/* Applicability and scope — includes exemptions / carve-outs as a
            sub-block when present. Exemptions are a scope question ("does
            this apply to *us*?"), so the lawyer's natural reading flow is
            scope → carve-outs together rather than as separate sections. */}
        {(editing || hasContent("applicability") || hasContent("exemptions")) && (
          <Section id="applicability" variant="primary" title="Applicability and scope" editing={editing} confidence={entry.sectionConfidence?.applicability}
            editEl={
              <div className="space-y-4">
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Applicability</h4>
                  <TA value={editData.applicability || ""} onChange={(v) => setEditData({ ...editData, applicability: v })} rows={5} />
                </div>
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Exemptions and carve-outs</h4>
                  <TA value={editData.exemptions || ""} onChange={(v) => setEditData({ ...editData, exemptions: v })} rows={4} />
                </div>
              </div>
            }
          >
            <div className="space-y-4">
              {(hasContent("applicability") || !hasContent("exemptions")) && (
                <SectionText
                  text={entry.applicability}
                  claims={entry.sectionClaims?.applicability}
                  emptyState="Applicability has not yet been assessed."
                />
              )}
              {hasContent("exemptions") && (
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Exemptions and carve-outs</h4>
                  <SectionText
                    text={entry.exemptions}
                    claims={entry.sectionClaims?.exemptions}
                    emptyState=""
                  />
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Key criteria & tests: structured threshold tests replace prose when
            both exist — same content, two formats. */}
        {(editing || hasContent("keyCriteria") || hasArtifact("thresholdTests")) && (
          <Section id="key-criteria" variant="primary" title="Key criteria and tests" editing={editing} confidence={entry.sectionConfidence?.keyCriteria}
            editEl={<TA value={editData.keyCriteria || ""} onChange={(v) => setEditData({ ...editData, keyCriteria: v })} rows={5} />}
          >
            {entry.thresholdTests && entry.thresholdTests.length > 0 ? (
              <ThresholdTestsView items={entry.thresholdTests} />
            ) : (
              <SectionText
                text={entry.keyCriteria}
                claims={entry.sectionClaims?.keyCriteria}
                emptyState="No operative thresholds, triggers, or legal tests have been recorded yet."
              />
            )}
          </Section>
        )}

        {(editing || hasContent("whyItMatters") || hasImpactLens) && (
          <Section id="business-impact" variant="primary" title="Business impact" editing={editing} confidence={entry.sectionConfidence?.whyItMatters}
            editEl={
              <div className="space-y-4">
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">For us — direct impact</h4>
                  <TA value={editData.impactOnUs || ""} onChange={(v) => setEditData({ ...editData, impactOnUs: v })} rows={2} />
                </div>
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">For our customers — pass-through impact</h4>
                  <TA value={editData.impactOnCustomers || ""} onChange={(v) => setEditData({ ...editData, impactOnCustomers: v })} rows={2} />
                </div>
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Full assessment</h4>
                  <TA value={editData.whyItMatters || ""} onChange={(v) => setEditData({ ...editData, whyItMatters: v })} rows={4} />
                </div>
              </div>
            }
          >
            <div className="space-y-4">
              {hasImpactLens && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ImpactLensCard label="For us" text={entry.impactOnUs} />
                  <ImpactLensCard label="For our customers" text={entry.impactOnCustomers} />
                </div>
              )}
              {hasContent("whyItMatters") && (
                <SectionText
                  text={entry.whyItMatters}
                  claims={entry.sectionClaims?.whyItMatters}
                  emptyState="Business impact has not yet been assessed."
                />
              )}
            </div>
          </Section>
        )}

        {/* Required actions: structured checklist is canonical when present;
            otherwise fall back to prose. */}
        {(editing || hasContent("complianceImplications") || hasArtifact("complianceChecklist")) && (
          <Section id="required-actions" variant="primary" title="Required actions" editing={editing} confidence={entry.sectionConfidence?.complianceImplications}
            editEl={<TA value={editData.complianceImplications || ""} onChange={(v) => setEditData({ ...editData, complianceImplications: v })} rows={6} />}
          >
            {entry.complianceChecklist && entry.complianceChecklist.length > 0 ? (
              <ComplianceChecklistView items={entry.complianceChecklist} />
            ) : (
              <SectionText
                text={entry.complianceImplications}
                claims={entry.sectionClaims?.complianceImplications}
                emptyState="No concrete compliance actions have been captured yet."
              />
            )}
          </Section>
        )}

        {(editing || hasContent("penalties")) && (
          <Section id="penalties" variant="primary" title="Penalties and enforcement" editing={editing} confidence={entry.sectionConfidence?.penalties}
            editEl={<TA value={editData.penalties || ""} onChange={(v) => setEditData({ ...editData, penalties: v })} rows={4} />}
          >
            <SectionText
              text={entry.penalties}
              claims={entry.sectionClaims?.penalties}
              emptyState="No penalties or enforcement posture have been recorded."
            />
          </Section>
        )}

        {/* Notes & watch items — combines AI-derived watch state (open
            interpretive questions, escalation triggers) with analyst-authored
            notes. All three are dynamic, ongoing-monitoring content rather
            than one-time analysis, so they share a section. Sub-blocks are
            only rendered when they have content. */}
        {(editing
          || hasContent("openQuestions")
          || hasArtifact("escalationTriggers")
          || entry.notes) && (
          <Section
            id="notes-watch"
            variant="primary"
            title="Notes & watch items"
            editing={editing}
            confidence={entry.sectionConfidence?.openQuestions}
            editEl={
              <div className="space-y-4">
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Open questions</h4>
                  <TA value={editData.openQuestions || ""} onChange={(v) => setEditData({ ...editData, openQuestions: v })} rows={4} />
                </div>
                <div>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Analyst notes</h4>
                  <TA value={editData.notes || ""} onChange={(v) => setEditData({ ...editData, notes: v })} placeholder="Internal commentary, follow-up reminders, GC discussions…" rows={4} />
                </div>
              </div>
            }
          >
            {(() => {
              const hasQuestions = hasContent("openQuestions");
              const hasTriggers = hasArtifact("escalationTriggers");
              const hasNotes = !!entry.notes;
              if (!hasQuestions && !hasTriggers && !hasNotes) {
                return <EmptyState message="No open questions, escalation triggers, or analyst notes have been recorded." />;
              }
              return (
                <div className="space-y-5">
                  {hasQuestions && (
                    <div>
                      <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Open questions</h4>
                      <SectionText
                        text={entry.openQuestions}
                        claims={entry.sectionClaims?.openQuestions}
                        emptyState=""
                      />
                    </div>
                  )}
                  {hasTriggers && (
                    <div>
                      <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Escalation triggers</h4>
                      <EscalationTriggersView items={entry.escalationTriggers!} />
                    </div>
                  )}
                  {hasNotes && (
                    <div>
                      <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2">Analyst notes</h4>
                      <FormattedText text={entry.notes!} />
                    </div>
                  )}
                </div>
              );
            })()}
          </Section>
        )}

        {/* Timeline — vertical legislative-journey view of keyDates. Past
            milestones are checked, the next upcoming one is highlighted as
            "next", and future ones are hollow dots. */}
        {entry.keyDates && entry.keyDates.length > 0 && (
          <Section id="timeline" title="Timeline" icon={<Calendar className="w-3.5 h-3.5 text-fg-3" />}>
            <LegislativeTimeline keyDates={entry.keyDates} />
          </Section>
        )}

        {/* In the news — digest stories that referenced this entry, newest
            first. The entry page = canonical summary + business relevance +
            recent narrative history (refinement plan B3). */}
        {newsStories.length > 0 && (
          <Section
            id="in-the-news"
            title={`In the news (${newsStories.length})`}
            icon={<Newspaper className="w-3.5 h-3.5 text-fg-3" />}
          >
            <div className="space-y-1">
              {newsStories.map((story) => (
                <EntryNewsRow key={story.id} story={story} />
              ))}
            </div>
          </Section>
        )}

        {/* Source Documents — always rendered. This is the primary surface
            for grounding analysis in primary sources, so it should be
            available even on brand-new entries. The Suggest button is the
            most-used affordance for new entries (model proposes
            authoritative sources to download), so it lives inline in the
            header alongside Add. */}
        <Section
          id="source-documents"
          title={`Source Documents${docsData?.documents && docsData.documents.length > 0 ? ` (${docsData.documents.length})` : ""}`}
          icon={<FileText className="w-3.5 h-3.5 text-fg-3" />}
          actions={
            <div className="flex items-center gap-3">
              {docsData?.documents && docsData.documents.length > 0 && (
                <button
                  onClick={async () => {
                    setRefreshing(true);
                    try {
                      const res = await fetch(
                        `/api/tracker/entries/${id}/refresh-sources`,
                        { method: "POST" }
                      );
                      const json = (await res.json()) as {
                        ok?: boolean;
                        total?: number;
                        changed?: number;
                        unchanged?: number;
                        failed?: number;
                        error?: string;
                      };
                      if (!res.ok || !json.ok) {
                        toast.error(json.error || "Refresh failed");
                      } else {
                        const changed = json.changed ?? 0;
                        const failed = json.failed ?? 0;
                        if (changed > 0) {
                          toast.success(
                            `${changed} source${changed === 1 ? "" : "s"} updated. See change history.`
                          );
                        } else if (failed > 0) {
                          toast.warning(
                            `No changes detected. ${failed} source${failed === 1 ? "" : "s"} could not be re-fetched.`
                          );
                        } else {
                          toast.success("All sources up to date.");
                        }
                        mutateDocs();
                      }
                    } finally {
                      setRefreshing(false);
                    }
                  }}
                  disabled={refreshing}
                  className="flex items-center gap-1 text-[11px] font-mono text-fg-3 transition-colors hover:text-accent disabled:opacity-50"
                >
                  <Clock className="w-3 h-3" />
                  {refreshing ? "Checking…" : "Check for updates"}
                </button>
              )}
              <button
                onClick={() => {
                  setShowSuggestPanel((v) => !v);
                  setShowDocForm(false);
                }}
                disabled={showSuggestPanel}
                className="flex items-center gap-1 text-[11px] font-mono text-accent transition-colors hover:text-accent-2 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                Suggest
              </button>
              <button
                onClick={() => {
                  setShowDocForm(!showDocForm);
                  setShowSuggestPanel(false);
                }}
                className="flex items-center gap-1 text-[11px] font-mono text-accent hover:text-accent-2 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {showDocForm ? "Cancel" : "Add"}
              </button>
            </div>
          }
        >
          {showSuggestPanel && (
            <SourceSuggestionPanel
              entryId={id}
              onClose={() => setShowSuggestPanel(false)}
              onApproved={() => mutateDocs()}
            />
          )}
          {/* URL leads — bookmarks that haven't been downloaded yet. Lives
              inside Source Documents because that's where they get promoted
              from. Hidden inside a disclosure to stay out of the way. */}
          {entry.sourceUrls && entry.sourceUrls.length > 0 && (
            <UrlLeadsBanner
              sources={entry.sourceUrls}
              entryId={entry.id}
              onPromoted={() => {
                mutate();
                mutateDocs();
              }}
            />
          )}
          {showDocForm && (
            <div className="mb-4 p-4 bg-surface border border-border rounded-xl space-y-3">
              <input
                type="text"
                placeholder="Document name (e.g. Personal Data Protection Act 2012)"
                value={docForm.name}
                onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-[13px] text-fg placeholder:text-fg-3 focus:outline-none focus:border-border-hover"
              />
              <input
                type="url"
                placeholder="Official source URL (optional)"
                value={docForm.sourceUrl}
                onChange={(e) => setDocForm({ ...docForm, sourceUrl: e.target.value })}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-[13px] text-fg placeholder:text-fg-3 focus:outline-none focus:border-border-hover"
              />
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.html,.json,.xml,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setDocForm({
                      ...docForm,
                      name: docForm.name || file.name.replace(/\.[^.]+$/, ""),
                      fullText: text.slice(0, 200000),
                    });
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-fg-2 bg-hover rounded-lg hover:bg-border transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  Upload text file
                </button>
                {docForm.fullText && (
                  <span className="text-[11px] text-fg-3">
                    {docForm.fullText.length.toLocaleString()} chars loaded
                  </span>
                )}
              </div>
              <textarea
                placeholder="Or paste legislation text directly..."
                value={docForm.fullText}
                onChange={(e) => setDocForm({ ...docForm, fullText: e.target.value })}
                rows={4}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-[13px] text-fg placeholder:text-fg-3 resize-y focus:outline-none focus:border-border-hover font-mono"
              />
              <button
                disabled={!docForm.name || docUploading}
                onClick={async () => {
                  setDocUploading(true);
                  try {
                    await addDocument(id, {
                      name: docForm.name,
                      sourceUrl: docForm.sourceUrl || undefined,
                      fullText: docForm.fullText || undefined,
                      fileType: docForm.fullText ? "txt" : "link",
                    });
                    setDocForm({ name: "", sourceUrl: "", fullText: "" });
                    setShowDocForm(false);
                    mutateDocs();
                  } finally {
                    setDocUploading(false);
                  }
                }}
                className="px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-lg hover:bg-accent-2 transition-colors disabled:opacity-40"
              >
                {docUploading ? "Adding..." : "Add Document"}
              </button>
            </div>
          )}

          {docsData?.documents && docsData.documents.length > 0 ? (
            <div className="space-y-1">
              {docsData.documents.map((doc) => (
                <div
                  key={doc.id}
                  id={`doc-${doc.id}`}
                  className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0 group"
                >
                  <FileText className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-fg truncate block">
                      {doc.name}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      {doc.charCount && (
                        <span className="text-[11px] text-fg-3 font-mono">
                          {doc.charCount.toLocaleString()} chars
                        </span>
                      )}
                      {doc.sourceAuthority && (
                        <AuthorityBadge authority={doc.sourceAuthority} />
                      )}
                      <FetchStatusBadge doc={doc} />
                      {doc.lastUrlCheck && (
                        <span className="text-[11px] text-fg-3">
                          Checked {relativeTime(doc.lastUrlCheck)}
                        </span>
                      )}
                      {doc.retrievedAt && (
                        <span className="text-[11px] text-fg-3">
                          Retrieved {formatDate(doc.retrievedAt)}
                        </span>
                      )}
                      {doc.sourceUrl && (
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-2 transition-colors"
                        >
                          <Link2 className="w-2.5 h-2.5" />
                          {(() => {
                            try { return new URL(doc.sourceUrl).hostname.replace("www.", ""); }
                            catch { return "source"; }
                          })()}
                        </a>
                      )}
                      <span className="text-[11px] text-fg-3 font-mono">{doc.addedBy}</span>
                    </div>
                    <FetchFailureRow doc={doc} entryId={id} onChange={mutateDocs} />
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm("Remove this source document?")) return;
                      await deleteDocument(id, doc.id);
                      mutateDocs();
                    }}
                    className="p-1.5 rounded-lg text-fg-3 opacity-0 group-hover:opacity-100 hover:text-[var(--red)] hover:bg-[var(--red-bg)] transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            !showDocForm && (
              <EmptyState
                message={
                  <>
                    No source documents linked.{" "}
                    <button onClick={() => setShowDocForm(true)} className="text-accent hover:underline">
                      Add the primary legislation text
                    </button>{" "}
                    to ground AI summaries in the official source.
                  </>
                }
              />
            )
          )}

          {/* Glossary — defined terms extracted from the docs above. Lives as
              a tucked-away disclosure inside the Source Documents section
              because the primary UX is the inline DefinedTermText highlights
              in the prose; the full glossary is reference material. */}
          {termsData?.terms && termsData.terms.length > 0 && (
            <GlossaryDisclosure terms={termsData.terms} />
          )}
        </Section>

        {/* Changes */}
        {changes && changes.length > 0 && (
          <Section id="change-history" title="Change history" icon={<Clock className="w-3.5 h-3.5 text-fg-3" />} defaultOpen={false}>
            {changes.map((c) => {
              const anchoredDoc = c.sourceSnapshotId
                ? docsData?.documents?.find((d) => d.id === c.sourceSnapshotId)
                : undefined;
              return (
                <div key={c.id} className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px]">
                      <span className="font-medium text-fg">{c.fieldChanged}</span>
                      <span className="text-fg-3"> updated</span>
                      {c.sectionRef && (
                        <>
                          <span className="text-fg-3"> at </span>
                          <span className="font-mono text-[11px] text-accent">{c.sectionRef}</span>
                        </>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-0.5 text-[11px] text-fg-3">
                      <span className="tabular-nums">{relativeTime(c.changedAt)}</span>
                      <span className="px-1.5 py-px bg-hover rounded text-fg-3">{c.changedBy}</span>
                      {anchoredDoc && (
                        <Link
                          href={`#doc-${anchoredDoc.id}`}
                          className="inline-flex items-center gap-0.5 hover:text-accent truncate max-w-[200px]"
                          title={anchoredDoc.name}
                        >
                          <FileText className="w-3 h-3" />
                          {anchoredDoc.name}
                        </Link>
                      )}
                      {c.sourceUrl && (
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 hover:text-accent"
                        >
                          source <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    {(c.oldValue || c.newValue) && (
                      <div className="grid gap-2 mt-3 md:grid-cols-2">
                        <ChangeValueCard
                          label="Before"
                          tone="old"
                          value={c.oldValue}
                        />
                        <ChangeValueCard
                          label="After"
                          tone="new"
                          value={c.newValue}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        {/* Cross-jurisdiction analogues — the AI-generated comparative
            analysis (relatedContext field). Renders only when generated;
            on-demand artifact via the Tools menu. */}
        {(editing || hasContent("relatedContext")) && (
          <Section
            id="cross-jurisdiction"
            variant="primary"
            title="Cross-jurisdiction analogues"
            editing={editing}
            confidence={entry.sectionConfidence?.relatedContext}
            editEl={<TA value={editData.relatedContext || ""} onChange={(v) => setEditData({ ...editData, relatedContext: v })} placeholder="Comparative analysis against analogous instruments in other jurisdictions..." rows={4} />}
          >
            <SectionText
              text={entry.relatedContext}
              claims={entry.sectionClaims?.relatedContext}
              emptyState="No cross-jurisdiction analogues have been captured."
            />
          </Section>
        )}

        {/* Typed relationship sections — each pulls from a different group
            in the API response (subordinate instruments, guidance, amendments,
            version chain). Renders only when its group has items. */}
        {relatedSubordinates.length > 0 && (
          <Section id="subordinate-instruments" title="Subordinate instruments" icon={<FileText className="w-3.5 h-3.5 text-fg-3" />}>
            <RelatedEntryList items={relatedSubordinates} />
          </Section>
        )}

        {relatedGuidance.length > 0 && (
          <Section id="guidance" title="Guidance" icon={<FileText className="w-3.5 h-3.5 text-fg-3" />}>
            <RelatedEntryList items={relatedGuidance} />
          </Section>
        )}

        {inFlightAmendments.length > 0 && (
          <Section id="in-flight" title="In-flight amendments" icon={<FileText className="w-3.5 h-3.5 text-fg-3" />}>
            <p className="text-[12px] text-fg-3 mb-2">Bills and amending acts that propose changes to this instrument and have not yet commenced.</p>
            <RelatedEntryList items={inFlightAmendments} />
          </Section>
        )}

        {amendmentHistory.length > 0 && (
          <Section id="amendment-history" title="Amendment history" icon={<FileText className="w-3.5 h-3.5 text-fg-3" />}>
            <p className="text-[12px] text-fg-3 mb-2">Amending acts that have commenced and are now folded into this instrument.</p>
            <RelatedEntryList items={amendmentHistory} />
          </Section>
        )}

        {(supersededBy.length > 0 || supersedes.length > 0) && (
          <Section id="version-chain" title="Version chain" icon={<FileText className="w-3.5 h-3.5 text-fg-3" />}>
            {supersededBy.length > 0 && (
              <>
                <p className="text-[12px] text-fg-3 mb-2">Replaced by:</p>
                <RelatedEntryList items={supersededBy} />
              </>
            )}
            {supersedes.length > 0 && (
              <>
                <p className="text-[12px] text-fg-3 mb-2 mt-3">Replaces:</p>
                <RelatedEntryList items={supersedes} />
              </>
            )}
          </Section>
        )}

        {/* Empty-state UX. Three cases when there's no analytical content:
              1. A generation is already in flight (e.g. auto-kicked on
                 entry creation) → show a "Generating preliminary…" state
                 so the user doesn't see "Nothing here yet" while content
                 is on its way.
              2. The last generation failed → show the error + retry.
              3. No generation has happened → show the Get-started panel. */}
        {!editing && !hasAnyContent && (
          generating ? (
            <GeneratingPlaceholder />
          ) : summaryStatus === "failed" ? (
            <FailedPlaceholder
              error={data?.entry?.summaryError ?? null}
              onRetry={triggerSummary}
            />
          ) : (
            <GetStartedPanel
              onGenerateSummary={triggerSummary}
              hasSourceDocs={!!docsData?.documents && docsData.documents.length > 0}
            />
          )
        )}
      </div>

      {/* Footer — meta strip with tags + AI provenance badge. Tags moved
          here from the masthead so they don't compete with the title; users
          read them when they want to organise, not when they want to read
          the law. */}
      {((entry.tags && entry.tags.length > 0) || entry.aiGenerated) && (
        <footer className="mt-12 pt-6 border-t border-border space-y-3">
          {entry.tags && entry.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mr-1">Tags</span>
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-hover px-2 py-0.5 font-mono text-[10px] text-fg-2"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {entry.aiGenerated && (
            <div className="flex items-center font-mono text-[10px] tracking-[0.02em] text-fg-3">
              <AgentBadge workflow="summary" timestamp={entry.updatedAt} />
            </div>
          )}
        </footer>
      )}
    </article>
    <aside className="hidden xl:block sticky top-20 self-start w-56 ml-10 flex-shrink-0">
      <EntryTOC sections={tocSections} />
      <QuickFacts entry={entry} />
    </aside>
    </div>
    </DefinedTermsContext.Provider>
  );
}

// Renders a list of related entries (subordinate, guidance, amendments,
// version chain). Same layout as the prior child-entries list — extracted so
// every typed relationship section uses the same row.
function RelatedEntryList({ items }: { items: RelatedEntryWithKind[] }) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <Link
          key={`${item.id}-${item.kind}-${item.direction}`}
          href={`/tracker/${item.id}`}
          className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-hover transition-colors group"
        >
          <StatusBadge status={item.status} />
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-medium text-fg group-hover:text-accent transition-colors truncate block">
              {item.shortName}
            </span>
            <span className="text-[11px] text-fg-3 font-mono">
              {ENTRY_TYPES.find((t) => t.value === item.type)?.label}
            </span>
          </div>
          {item.nextKeyDate && (
            <span className="text-[11px] tabular-nums text-fg-3">
              {formatDate(item.nextKeyDate)}
            </span>
          )}
          <ImpactIndicator score={item.impactScore} />
        </Link>
      ))}
    </div>
  );
}

function Section({
  title,
  children,
  editing,
  editEl,
  icon,
  defaultOpen = true,
  actions,
  confidence,
  id,
  variant = "secondary",
}: {
  title: string;
  children: React.ReactNode;
  editing?: boolean;
  editEl?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  confidence?: SectionConfidence;
  id?: string;
  // primary    = analytical sections (Summary, Applicability, …) — large
  //              heading, never collapsible, generous spacing.
  // secondary  = operational / reference (Source Documents, Change history,
  //              Analyst notes) — small mono label, collapsible by default.
  variant?: "primary" | "secondary";
}) {
  const collapsible = variant === "secondary";
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open || editing;

  if (variant === "primary") {
    // Plain heading + body. No chevron, no toggle. These are the sections
    // the user came to read; collapsing them isn't useful and 8 chevrons
    // stacked vertically was visual noise.
    return (
      <section id={id} className="scroll-mt-8">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-fg flex-1 min-w-0">
            {title}
          </h2>
          {confidence && <ConfidenceBadge confidence={confidence} />}
          {actions}
        </div>
        <div className="text-[14px] leading-relaxed text-fg-2">
          {editing && editEl ? editEl : children}
        </div>
      </section>
    );
  }

  // Collapsible secondary section — the toggle is a real <button> wrapping
  // just the title affordance. Actions sit as a sibling on the right.
  return (
    <section id={id} className="scroll-mt-8">
      <div className="flex items-center gap-2 w-full">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left group"
        >
          <ChevronRight className={`w-3 h-3 text-fg-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          {icon}
          <h3 className="label-mono">{title}</h3>
          {confidence && <ConfidenceBadge confidence={confidence} />}
        </button>
        {actions}
      </div>
      {expanded && (
        <div className="mt-2 pl-5">
          {editing && editEl ? editEl : <div>{children}</div>}
        </div>
      )}
    </section>
  );
}

// One row of the "In the news" timeline: date · title · source, linking to
// the digest issue (anchored to the story) when the story belongs to one.
function EntryNewsRow({ story }: { story: EntryNewsStory }) {
  const href = story.issueSlug ? `/digest/issues/${story.issueSlug}#${story.id}` : story.url;
  const inner = (
    <>
      <span className="w-[72px] flex-shrink-0 font-mono text-[11px] tabular-nums text-fg-3">
        {formatDate(story.date)}
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg-2 group-hover:text-fg">
          {story.title}
        </span>
        <span className="block truncate font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
          {story.source}
          {story.issueTitle ? ` · ${story.issueTitle}` : ""}
        </span>
      </div>
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
    </>
  );
  const className =
    "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover";
  if (!href) {
    return <div className={className}>{inner}</div>;
  }
  return story.issueSlug ? (
    <Link href={href} className={className}>{inner}</Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{inner}</a>
  );
}

// Dual impact lens card — the pre-written answer to "what does this mean for
// us / for our customers?". Deliberately compact: one card per lens, no
// claims apparatus.
function ImpactLensCard({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="rounded-xl border border-border bg-bg px-4 py-3">
      <h4 className="font-mono text-[10px] uppercase tracking-[0.04em] text-accent mb-1.5">{label}</h4>
      {text ? (
        <p className="text-[13px] leading-relaxed text-fg-2">{text}</p>
      ) : (
        <p className="text-[13px] leading-relaxed text-fg-3 italic">Not yet assessed.</p>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: SectionConfidence }) {
  const config = CONFIDENCE_LEVELS.find((c) => c.value === confidence.level);
  if (!config) return null;
  return (
    <span className="relative group/conf">
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium leading-none"
        style={{ color: config.color, background: `${config.color}15`, border: `1px solid ${config.color}30` }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
        {config.label}
      </span>
      <span className="absolute left-0 top-full mt-1 z-50 hidden group-hover/conf:block w-64 px-3 py-2 rounded-lg bg-surface border border-border text-[11px] text-fg-2 leading-relaxed shadow-xl">
        {confidence.basis}
      </span>
    </span>
  );
}

function UrlLeadsBanner({
  sources,
  entryId,
  onPromoted,
}: {
  sources: NonNullable<Entry["sourceUrls"]>;
  entryId: string;
  onPromoted: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight className={`w-3 h-3 text-fg-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        <ExternalLink className="w-3.5 h-3.5 text-amber-500/80" />
        <span className="text-[12px] text-fg-2">
          {sources.length} URL lead{sources.length === 1 ? "" : "s"} not yet downloaded — promote to use in analysis
        </span>
      </button>
      {open && (
        <div className="mt-2 pl-7">
          {sources.map((source, i) => {
            const url = typeof source === "string" ? source : source.url;
            const tier = typeof source === "string" ? undefined : source.tier;
            const tierConfig = tier ? SOURCE_TIERS.find((t) => t.value === tier) : undefined;
            let host = url;
            try { host = new URL(url).hostname.replace("www.", ""); } catch { /* ok */ }
            return (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-accent hover:text-accent-2 transition-colors min-w-0 flex-1">
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{(typeof source === "string" ? null : source.label) || host}</span>
                </a>
                {tierConfig && (
                  <span
                    className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium leading-none whitespace-nowrap"
                    style={{ color: tierConfig.color, background: `${tierConfig.color}15`, border: `1px solid ${tierConfig.color}30` }}
                  >
                    {tierConfig.label}
                  </span>
                )}
                <PromoteUrlButton entryId={entryId} url={url} onSuccess={onPromoted} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GlossaryDisclosure({ terms }: { terms: DefinedTerm[] }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => [...terms].sort((a, b) => a.term.localeCompare(b.term)), [terms]);
  return (
    <div className="mt-4 pt-3 border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-left"
      >
        <ChevronRight className={`w-3 h-3 text-fg-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
          Glossary ({terms.length} defined term{terms.length === 1 ? "" : "s"})
        </span>
      </button>
      {open && (
        <div className="mt-2 pl-5">
          <p className="mb-2 text-[12px] text-fg-3 leading-relaxed">
            Statutory definitions extracted from the source documents. The AI uses these
            when interpreting the law, and they&apos;re highlighted inline in the prose above.
          </p>
          <ul className="space-y-2">
            {sorted.map((t) => (
              <li key={t.id} className="text-[13px] leading-relaxed">
                <span className="font-medium text-fg">&ldquo;{t.term}&rdquo;</span>
                {t.sectionRef && (
                  <span className="ml-1.5 font-mono text-[10px] text-fg-3">
                    {t.sectionRef}
                  </span>
                )}
                <div className="mt-0.5 text-fg-2">{t.definition}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: React.ReactNode }) {
  return <div className="text-[13px] text-fg-3">{message}</div>;
}

function SectionText({
  text,
  claims,
  emptyState,
}: {
  text: string | null | undefined;
  claims: EntryClaim[] | null | undefined;
  emptyState: React.ReactNode;
}) {
  if (claims && claims.length > 0) {
    const intro = extractIntro(text);
    return (
      <div className="space-y-3">
        {intro && (
          <p className="text-[14px] leading-relaxed">
            <DefinedTermText>{intro}</DefinedTermText>
          </p>
        )}
        <ClaimList claims={claims} />
      </div>
    );
  }

  if (text) {
    return <FormattedText text={text} />;
  }

  return <EmptyState message={emptyState} />;
}

// --------------------------------------------------------------------------
// Phase 5.1 practitioner output renderers.
// --------------------------------------------------------------------------

function ComplianceChecklistView({ items }: { items: ComplianceChecklistItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="text-[13px] leading-relaxed">
          <div className="flex items-start gap-2">
            <span className="mt-[3px] flex-shrink-0 select-none font-mono text-[10px] text-fg-3">☐</span>
            <span className="min-w-0">
              <span className="text-fg">
                <DefinedTermText>{item.action}</DefinedTermText>
              </span>
              <span className="ml-2 inline-flex items-center gap-2 font-mono text-[10px] text-fg-3">
                <span>{item.owner || "Unassigned"}</span>
                {item.sectionRef && <span>· {item.sectionRef}</span>}
              </span>
              {item.evidence && (
                <div className="mt-0.5 text-[12px] text-fg-3">
                  <span className="font-mono text-[10px] uppercase tracking-wider">Evidence: </span>
                  {item.evidence}
                </div>
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ThresholdTestsView({ items }: { items: ThresholdTest[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="text-[13px] leading-relaxed">
          <div className="flex items-baseline gap-2">
            <span className="mt-[1px] flex-shrink-0 font-mono text-[11px] text-fg-3">{i + 1}.</span>
            <div className="min-w-0">
              <div className="text-fg">
                <DefinedTermText>{item.question}</DefinedTermText>
                {item.sectionRef && (
                  <span className="ml-1.5 font-mono text-[10px] text-fg-3">{item.sectionRef}</span>
                )}
              </div>
              <div className="mt-1 ml-3 space-y-0.5 text-[12px] text-fg-2">
                {item.ifYes && (
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3">Yes → </span>
                    <DefinedTermText>{item.ifYes}</DefinedTermText>
                  </div>
                )}
                {item.ifNo && (
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3">No → </span>
                    <DefinedTermText>{item.ifNo}</DefinedTermText>
                  </div>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function EscalationTriggersView({ items }: { items: EscalationTrigger[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="text-[13px] leading-relaxed">
          <div className="flex gap-2">
            <span className="mt-[3px] flex-shrink-0 select-none text-[10px] text-fg-3">⚑</span>
            <span className="min-w-0">
              <span className="text-fg">
                <DefinedTermText>{item.trigger}</DefinedTermText>
              </span>
              {item.sectionRef && (
                <span className="ml-1.5 font-mono text-[10px] text-fg-3">{item.sectionRef}</span>
              )}
              {item.condition && (
                <div className="mt-0.5 text-[12px] text-fg-2">
                  <DefinedTermText>{item.condition}</DefinedTermText>
                </div>
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------
// Defined-term highlighting. The page provides the registry via context; any
// rendered prose can wrap itself in <DefinedTermText> to underline terms that
// appear in the registry and show their statutory definition on hover.
// --------------------------------------------------------------------------

interface DefinedTerm {
  id: string;
  term: string;
  definition: string;
  sectionRef: string | null;
  scope: string;
}

const DefinedTermsContext = createContext<DefinedTerm[]>([]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build one combined regex with all term names so we don't pay a separate scan
// per term. Sorted longest-first so multi-word terms ("personal information")
// win over their substrings ("information"). Memoised by term-list identity.
function useTermRegex(terms: DefinedTerm[]) {
  return useMemo(() => {
    if (terms.length === 0) return null;
    const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
    const pattern = sorted.map((t) => escapeRegex(t.term)).join("|");
    // \b word-boundary on both sides so we don't match inside a longer word.
    // The `i` flag makes the match case-insensitive.
    return {
      regex: new RegExp(`\\b(?:${pattern})\\b`, "gi"),
      byLower: new Map(sorted.map((t) => [t.term.toLowerCase(), t])),
    };
  }, [terms]);
}

function DefinedTermText({ children }: { children: string }) {
  const terms = useContext(DefinedTermsContext);
  const built = useTermRegex(terms);

  if (!built || !children) return <>{children}</>;

  const { regex, byLower } = built;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // String.matchAll yields each match without mutating the regex's internal
  // state, which is important since the regex is memoised across renders.
  for (const match of children.matchAll(regex)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      parts.push(children.slice(lastIndex, idx));
    }
    const matched = match[0];
    const term = byLower.get(matched.toLowerCase());
    if (term) {
      parts.push(<DefinedTermMark key={`t-${key++}`} term={term} display={matched} />);
    } else {
      parts.push(matched);
    }
    lastIndex = idx + matched.length;
  }
  if (lastIndex < children.length) {
    parts.push(children.slice(lastIndex));
  }

  return <>{parts}</>;
}

function DefinedTermMark({ term, display }: { term: DefinedTerm; display: string }) {
  return (
    <span className="relative inline-block group/term">
      <span className="border-b border-dotted border-fg-3 cursor-help">{display}</span>
      <span
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 hidden group-hover/term:block w-72 px-3 py-2 rounded-lg bg-surface border border-border text-[11px] text-fg-2 leading-relaxed shadow-xl"
        role="tooltip"
      >
        <div className="font-medium text-fg">&ldquo;{term.term}&rdquo;</div>
        {term.sectionRef && (
          <div className="mt-0.5 font-mono text-[10px] text-fg-3">{term.sectionRef}</div>
        )}
        <div className="mt-1 text-fg-2">{term.definition}</div>
      </span>
    </span>
  );
}

function PromoteUrlButton({
  entryId,
  url,
  onSuccess,
}: {
  entryId: string;
  url: string;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/tracker/entries/${entryId}/promote-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
            toast.error(body.error || "Could not download URL", {
              description: body.detail,
            });
            return;
          }
          const body = (await res.json()) as { deduped?: boolean };
          toast.success(
            body.deduped ? "Already a source document" : "Downloaded as source document"
          );
          onSuccess();
        } catch {
          toast.error("Could not download URL");
        } finally {
          setBusy(false);
        }
      }}
      className="flex-shrink-0 inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface px-2 py-1 text-[11px] font-mono text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {busy ? "Downloading…" : "Download"}
    </button>
  );
}

function ClaimList({ claims }: { claims: EntryClaim[] }) {
  // Footnote numbering is per-section. Only claims with a citation that points
  // to a source (doc or url) get a number; ungrounded claims read as plain
  // bullets.
  const numbered = claims.reduce<{ claim: EntryClaim; footnote: number | null }[]>(
    (acc, claim) => {
      const cite = claim.citation;
      const hasSource = !!(cite && (cite.sourceDocumentId || cite.sourceUrl));
      if (!hasSource) {
        acc.push({ claim, footnote: null });
        return acc;
      }
      const next =
        acc.reduce((max, e) => (e.footnote !== null && e.footnote > max ? e.footnote : max), 0) + 1;
      acc.push({ claim, footnote: next });
      return acc;
    },
    []
  );

  return (
    <ul className="space-y-1.5">
      {numbered.map(({ claim, footnote }, i) => (
        <li key={`${claim.text}-${i}`} className="flex gap-2 text-[14px] leading-relaxed text-fg-2">
          <span className="text-fg-3 mt-[3px] flex-shrink-0 select-none">•</span>
          <span className="min-w-0">
            <DefinedTermText>{claim.text}</DefinedTermText>
            {footnote !== null && (
              <CitationFootnote claim={claim} index={footnote} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Subtle superscript footnote marker. Hover shows source provenance; click
// scrolls to the source-document panel below the entry. No groundingType
// pills, no inline notes — the popover holds everything.
function CitationFootnote({ claim, index }: { claim: EntryClaim; index: number }) {
  const cite = claim.citation;
  if (!cite) return null;

  const targetId = cite.sourceDocumentId ? `doc-${cite.sourceDocumentId}` : null;
  const externalUrl = !cite.sourceDocumentId ? cite.sourceUrl ?? null : null;

  // Render the marker as a link when we can navigate to a source. Otherwise
  // it's just a hover-only marker (rare — only when citation has note text but
  // no link target).
  const Marker = (
    <sup className="ml-0.5 align-super text-[10px] font-mono text-fg-3 hover:text-accent cursor-pointer transition-colors">
      [{index}]
    </sup>
  );

  return (
    <span className="relative inline-block group/cite">
      {targetId ? (
        <a href={`#${targetId}`} className="no-underline">
          {Marker}
        </a>
      ) : externalUrl ? (
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="no-underline">
          {Marker}
        </a>
      ) : (
        Marker
      )}
      <CitationPopover claim={claim} />
    </span>
  );
}

// Popover anchored to the footnote marker. Shows source name/section,
// grounding type, verification annotations, and any analyst notes.
function CitationPopover({ claim }: { claim: EntryClaim }) {
  const cite = claim.citation;
  if (!cite) return null;

  const groundingLabel = cite.groundingType
    ? cite.groundingType.replace(/_/g, " ")
    : null;

  return (
    <span
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 hidden group-hover/cite:block w-72 px-3 py-2 rounded-lg bg-surface border border-border text-[11px] text-fg-2 leading-relaxed shadow-xl"
      role="tooltip"
    >
      {cite.sourceDocumentName && (
        <div className="font-medium text-fg">{cite.sourceDocumentName}</div>
      )}
      {!cite.sourceDocumentName && cite.sourceUrl && (
        <div className="font-medium text-fg break-all">{cite.sourceUrl}</div>
      )}
      {cite.sectionRef && (
        <div className="mt-0.5 font-mono text-[10px] text-fg-3">{cite.sectionRef}</div>
      )}
      {groundingLabel && (
        <div className="mt-1 text-[10px] text-fg-3">
          <span className="opacity-70">grounding: </span>
          {groundingLabel}
        </div>
      )}
      {cite.note && (
        <div className="mt-1.5 pt-1.5 border-t border-border/50 text-fg-3">
          {cite.note}
        </div>
      )}
    </span>
  );
}

function AuthorityBadge({ authority }: { authority: SourceAuthority }) {
  const meta = SOURCE_AUTHORITY_META[authority] ?? SOURCE_AUTHORITY_META.unknown;
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
      style={{
        color: meta.color,
        background: meta.background,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.label}
    </span>
  );
}

function ChangeValueCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "old" | "new";
  value: string | null;
}) {
  const Icon = tone === "old" ? Minus : Check;
  const toneClass =
    tone === "old"
      ? "border-border/70 bg-surface"
      : "border-[color:rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.06)]";

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-[12px] leading-relaxed text-fg-2 whitespace-pre-wrap break-words">
        {value && value.trim().length > 0 ? value : "—"}
      </div>
    </div>
  );
}

function TA({ value, onChange, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea
      value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-[14px] text-fg placeholder:text-fg-3 resize-y focus:outline-none focus:shadow-[var(--shadow-m)] focus:border-border-hover transition-all"
    />
  );
}

function FormattedText({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/).filter(Boolean);

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const lines = block.split(/\n/).filter(Boolean);
        const introLines: string[] = [];
        const bulletLines: string[] = [];

        for (const line of lines) {
          if (/^[•\-\*]\s/.test(line.trim())) {
            bulletLines.push(line.replace(/^[•\-\*]\s*/, "").trim());
          } else {
            // If we haven't started bullets yet, it's intro text
            if (bulletLines.length === 0) {
              introLines.push(line);
            } else {
              // Text after bullets — append to last bullet
              bulletLines[bulletLines.length - 1] += " " + line.trim();
            }
          }
        }

        if (bulletLines.length > 0) {
          return (
            <div key={i}>
              {introLines.length > 0 && (
                <p className="mb-2 text-[14px] leading-relaxed">
                  <DefinedTermText>{introLines.join(" ")}</DefinedTermText>
                </p>
              )}
              <ul className="space-y-1 ml-0.5">
                {bulletLines.map((bullet, j) => {
                  // Check for "Label: detail" pattern
                  const colonMatch = bullet.match(/^([^:]{2,40}):\s+(.+)$/);
                  return (
                    <li key={j} className="flex gap-2.5 text-[14px] leading-relaxed py-0.5">
                      <span className="text-accent mt-[3px] flex-shrink-0 text-[10px]">&#9679;</span>
                      <span>
                        {colonMatch ? (
                          <>
                            <span className="font-medium text-fg">{colonMatch[1]}:</span>{" "}
                            <DefinedTermText>{colonMatch[2]}</DefinedTermText>
                          </>
                        ) : (
                          <DefinedTermText>{bullet}</DefinedTermText>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }

        return (
          <p key={i} className="text-[14px] leading-relaxed">
            <DefinedTermText>{introLines.join(" ")}</DefinedTermText>
          </p>
        );
      })}
    </div>
  );
}

function extractIntro(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const introLines: string[] = [];

  for (const line of lines) {
    if (/^[•\-\*]\s/.test(line)) break;
    introLines.push(line);
  }

  return introLines.length > 0 ? introLines.join(" ") : null;
}

// Single ••• menu sitting next to "Generate Summary" in the masthead. Holds
// every secondary action so the masthead stays a one-button row:
//   - Generate / regenerate the four on-demand artifacts
//   - Suggest sources (was an inline button on Source Documents)
//   - Edit, Flag/Unflag, Archive
// Each artifact item shows an inline status indicator (running spinner /
// failed marker / present checkmark) so the menu doubles as the one place
// to read job state across all artifacts.
function ToolsMenu({
  artifactPresent,
  artifactStatus,
  flagged,
  onArtifact,
  onSuggestSources,
  onEdit,
  onToggleFlag,
  onArchive,
}: {
  artifactPresent: Record<ArtifactKind, boolean>;
  artifactStatus: (kind: ArtifactKind) => "idle" | "running" | "failed";
  flagged: boolean;
  onArtifact: (kind: ArtifactKind) => void;
  onSuggestSources: () => void;
  onEdit: () => void;
  onToggleFlag: () => void;
  onArchive: () => void;
}) {
  const order: ArtifactKind[] = [
    "complianceChecklist",
    "thresholdTests",
    "escalationTriggers",
    "crossJurisdictionAnalogues",
  ];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Tools menu"
          className="flex items-center justify-center w-7 h-7 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-hover transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 min-w-[260px] rounded-xl border border-border bg-surface p-1 shadow-xl"
        >
          <DropdownMenu.Label className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
            Generate
          </DropdownMenu.Label>
          {order.map((kind) => {
            const status = artifactStatus(kind);
            const present = artifactPresent[kind];
            const running = status === "running";
            const failed = status === "failed";
            return (
              <DropdownMenu.Item
                key={kind}
                disabled={running}
                onSelect={() => onArtifact(kind)}
                className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-fg-2 rounded-md cursor-pointer outline-none data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[disabled]:opacity-50 data-[disabled]:cursor-default"
              >
                <ArtifactStatusIcon running={running} failed={failed} present={present} />
                <span className="flex-1">
                  {present ? `Regenerate ${ARTIFACT_LABEL[kind].toLowerCase()}` : ARTIFACT_LABEL[kind]}
                </span>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Item
            onSelect={onSuggestSources}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-fg-2 rounded-md cursor-pointer outline-none data-[highlighted]:bg-hover data-[highlighted]:text-fg"
          >
            <Sparkles className="w-3.5 h-3.5 text-fg-3" />
            <span className="flex-1">Suggest sources</span>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item
            onSelect={onEdit}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-fg-2 rounded-md cursor-pointer outline-none data-[highlighted]:bg-hover data-[highlighted]:text-fg"
          >
            <Pencil className="w-3.5 h-3.5 text-fg-3" />
            <span className="flex-1">Edit entry</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onToggleFlag}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-fg-2 rounded-md cursor-pointer outline-none data-[highlighted]:bg-hover data-[highlighted]:text-fg"
          >
            <Flag
              className={`w-3.5 h-3.5 ${flagged ? "text-[var(--amber)]" : "text-fg-3"}`}
              fill={flagged ? "currentColor" : "none"}
            />
            <span className="flex-1">{flagged ? "Unflag" : "Flag for review"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onArchive}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-fg-2 rounded-md cursor-pointer outline-none data-[highlighted]:bg-[var(--red-bg)] data-[highlighted]:text-[var(--red)]"
          >
            <Trash2 className="w-3.5 h-3.5 text-fg-3" />
            <span className="flex-1">Archive entry</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ArtifactStatusIcon({ running, failed, present }: {
  running: boolean; failed: boolean; present: boolean;
}) {
  if (running) return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />;
  if (failed) return <AlertCircle className="w-3.5 h-3.5 text-[var(--red)]" />;
  if (present) return <Check className="w-3.5 h-3.5 text-[var(--green)]" />;
  return <Sparkles className="w-3.5 h-3.5 text-fg-3" />;
}

// Compact pill summarizing the source-doc fetch outcome. Shown next to the
// authority badge so the user can tell at a glance whether a doc has usable
// text (the difference between full and preliminary analysis).
function FetchStatusBadge({
  doc,
}: {
  doc: import("@/lib/types").SourceDocument;
}) {
  // Legacy rows have no fetchStatus — derive from fullText so they don't all
  // look broken until something touches them.
  const status =
    doc.fetchStatus ?? (doc.fullText ? "ok" : doc.sourceUrl ? "fetch_failed" : "manual");

  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--green)]">
        <ShieldCheck className="w-3 h-3" />
        Text extracted
      </span>
    );
  }
  if (status === "manual") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-fg-3">
        <ShieldCheck className="w-3 h-3" />
        Pasted text
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--red)]">
      <ShieldAlert className="w-3 h-3" />
      {status === "no_text" ? "No text extracted" : "Fetch failed"}
    </span>
  );
}

// One-line failure detail + retry button, only rendered when a doc lacks
// usable text. Keeps the success-case row visually clean while making
// failures impossible to miss.
function FetchFailureRow({
  doc,
  entryId,
  onChange,
}: {
  doc: import("@/lib/types").SourceDocument;
  entryId: string;
  onChange: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const status =
    doc.fetchStatus ?? (doc.fullText ? "ok" : doc.sourceUrl ? "fetch_failed" : "manual");
  if (status === "ok" || status === "manual") return null;

  const reason =
    doc.fetchError ??
    (status === "no_text"
      ? "URL was reachable but the extractor produced no text (likely a scanned PDF or JS-only page)."
      : "URL could not be retrieved.");

  return (
    <div className="mt-1 rounded-md border border-[color:var(--red)]/30 bg-[var(--red-bg)] px-2 py-1.5">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-3 h-3 text-[var(--red)] mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-fg-2 leading-snug">
            <span className="font-medium text-[var(--red)]">No text available</span>
            {" — "}
            {reason}
          </p>
          <p className="text-[11px] text-fg-3 mt-0.5">
            Full analysis can&rsquo;t use this source. Retry, or remove and paste the text manually.
          </p>
        </div>
        {doc.sourceUrl && (
          <button
            type="button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                const result = await refetchDocument(entryId, doc.id);
                if (result.ok) {
                  toast.success("Source re-fetched");
                } else {
                  toast.error("Refetch still failed", {
                    description: result.body?.error ?? `HTTP ${result.status}`,
                  });
                }
                onChange();
              } finally {
                setRetrying(false);
              }
            }}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--red)]/10 text-[var(--red)] px-2 py-1 text-[11px] font-mono font-medium hover:bg-[var(--red)]/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying…" : "Retry fetch"}
          </button>
        )}
      </div>
    </div>
  );
}

function PreliminaryBanner({
  onSuggestSources,
  onAddSource,
  onRegenerate,
  hasDocs,
  regenerating,
}: {
  onSuggestSources: () => void;
  onAddSource: () => void;
  onRegenerate: () => void;
  hasDocs: boolean;
  regenerating: boolean;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--amber)]/30 bg-[var(--amber-bg)] px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-[var(--amber)] mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-fg">
            Preliminary analysis
          </div>
          <p className="mt-0.5 text-[12px] text-fg-2 leading-relaxed">
            This summary was generated from model knowledge alone — no source documents were attached. Treat all claims as unverified. {hasDocs
              ? "Source documents are now linked — regenerate for grounded analysis with citations."
              : "Add the primary legislation text to enable a grounded analysis with citations."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hasDocs ? (
              <button
                type="button"
                disabled={regenerating}
                onClick={onRegenerate}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent text-white px-2.5 py-1 text-[11px] font-mono font-medium hover:bg-accent-2 transition-colors disabled:opacity-50"
              >
                <Sparkles className={`w-3 h-3 ${regenerating ? "animate-spin" : ""}`} />
                {regenerating ? "Generating…" : "Run full analysis"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onSuggestSources}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent/10 text-accent px-2.5 py-1 text-[11px] font-mono font-medium hover:bg-accent/20 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  Suggest sources
                </button>
                <button
                  type="button"
                  onClick={onAddSource}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-mono text-fg-2 hover:bg-hover transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add source
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneratingPlaceholder() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
        <Loader2 className="h-5 w-5 text-accent animate-spin" />
      </div>
      <h2 className="text-[16px] font-semibold text-fg">Drafting preliminary analysis</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-fg-3 leading-relaxed">
        Sentinel is sketching a quick model-knowledge summary while you work on attaching source documents. This usually takes 30–90 seconds.
      </p>
    </div>
  );
}

function FailedPlaceholder({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-[color:var(--red)]/30 bg-[var(--red-bg)] px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--red)]/15">
        <AlertCircle className="h-5 w-5 text-[var(--red)]" />
      </div>
      <h2 className="text-[16px] font-semibold text-fg">Generation failed</h2>
      {error && (
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-fg-3 leading-relaxed break-words">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-2 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}

function GetStartedPanel({
  hasSourceDocs,
  onGenerateSummary,
}: {
  hasSourceDocs: boolean;
  onGenerateSummary: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
        <Sparkles className="h-5 w-5 text-accent" />
      </div>
      <h2 className="text-[16px] font-semibold text-fg">Nothing here yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-fg-3 leading-relaxed">
        {hasSourceDocs
          ? "Source documents are linked but no analysis has been generated. Generate a summary to draft applicability, criteria, business impact, and required actions."
          : "Add the primary legislation text as a source document, then generate a summary. Or use the Tools menu to create individual artifacts."}
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onGenerateSummary}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-2 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate Summary
        </button>
      </div>
    </div>
  );
}
