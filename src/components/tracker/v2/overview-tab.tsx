"use client";

// Overview — the instrument stated on its own terms.
//
// The organising rule for v2: Overview says what the law is, Analysis says
// what it means for us. v1 interleaved the two down one column, which made the
// neutral half impossible to read (or reuse) on its own.
//
// Two structural changes from v1 land here:
//
//  • Threshold tests are no longer a standalone artifact section. They are the
//    mechanism that answers "does this apply to us?", so they render inside
//    Application & scope as a numbered decision walk.
//  • The seven typed relationship sections collapse into one Related block
//    where each row states the job the other instrument does, rather than
//    seven near-identical lists.

import Link from "next/link";
import type { Entry, EntryDetailResponse, RelatedEntryWithKind, ThresholdTest } from "@/lib/types";
import { ENTRY_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Section,
  ClaimProse,
  CitationRef,
  condense,
  ExpandableText,
} from "./primitives";

export function OverviewTab({ data }: { data: EntryDetailResponse }) {
  const entry = data.entry;
  const claims = entry.sectionClaims ?? {};
  const confidence = entry.sectionConfidence ?? {};

  return (
    <div className="space-y-11">
      <ScopeSection entry={entry} />
      <Section title="Summary" confidence={confidence.summary}>
        <ClaimProse
          text={entry.summary}
          claims={claims.summary}
          empty="No summary has been prepared."
        />
      </Section>

      {/* Satellite delta — an amendment or guidance note carries the change it
          makes, not a second copy of the anchor's obligations. */}
      {entry.whatItChanges && (
        <Section title="What this changes" confidence={confidence.summary}>
          <ClaimProse text={entry.whatItChanges} claims={null} />
        </Section>
      )}
      {entry.whatItClarifies && (
        <Section title="What this clarifies" confidence={confidence.summary}>
          <ClaimProse text={entry.whatItClarifies} claims={null} />
        </Section>
      )}
      {entry.outcome && (
        <Section title="Outcome" confidence={confidence.summary}>
          <ClaimProse text={entry.outcome} claims={null} />
        </Section>
      )}


      {(entry.keyCriteria || claims.keyCriteria?.length) && (
        <Section
          title="Key criteria"
          kicker="the operative obligations"
          confidence={confidence.keyCriteria}
        >
          <ClaimProse text={entry.keyCriteria} claims={claims.keyCriteria} />
        </Section>
      )}

      {(entry.penalties || claims.penalties?.length) && (
        <Section title="Penalties and enforcement" confidence={confidence.penalties}>
          <ClaimProse text={entry.penalties} claims={claims.penalties} />
        </Section>
      )}

      <RelatedSection data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application & scope
// ---------------------------------------------------------------------------

function ScopeSection({ entry }: { entry: Entry }) {
  const claims = entry.sectionClaims ?? {};
  const confidence = entry.sectionConfidence ?? {};
  const tests = entry.thresholdTests ?? [];
  const hasScope = !!(entry.applicability || claims.applicability?.length);
  const hasExemptions = !!(entry.exemptions || claims.exemptions?.length);

  if (!hasScope && !hasExemptions && tests.length === 0) return null;

  return (
    <Section
      title="Application and scope"
      kicker="who it binds, and whether that includes us"
      confidence={confidence.applicability}
    >
      <div className="space-y-7">
        {hasScope && (
          <ClaimProse text={entry.applicability} claims={claims.applicability} />
        )}

        {tests.length > 0 && <ThresholdWalk tests={tests} />}

        {hasExemptions && (
          <div>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">
              Exemptions and carve-outs
            </h3>
            <ClaimProse text={entry.exemptions} claims={claims.exemptions} empty="" />
          </div>
        )}
      </div>
    </Section>
  );
}

// The in-scope test, rendered as an ordered walk. Numbering is meaningful here
// — the questions are sequential and each answer gates the next — so the
// ordinal is information, not decoration.
function ThresholdWalk({ tests }: { tests: ThresholdTest[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">
          Does it apply to us?
        </h3>
      </div>
      <ol className="divide-y divide-border">
        {tests.map((test, i) => {
          const q = condense(test.question, 120);
          return (
            <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 px-4 py-3.5">
              <span className="mt-px font-mono text-[12px] tabular-nums text-fg-3">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-[16px] leading-relaxed text-fg">
                  <ExpandableText head={q.head} rest={q.rest} />
                  {test.sectionRef && (
                    <CitationRef claim={{ text: "", citation: { sectionRef: test.sectionRef } }} />
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  {test.ifYes && <Branch verdict="Yes" text={test.ifYes} />}
                  {test.ifNo && <Branch verdict="No" text={test.ifNo} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Branch({ verdict, text }: { verdict: "Yes" | "No"; text: string }) {
  const t = condense(text, 110);
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 text-[14px] leading-relaxed">
      <span
        className={`font-mono text-[11px] uppercase tracking-[0.04em] ${
          verdict === "Yes" ? "text-[var(--green-text)]" : "text-fg-3"
        }`}
      >
        {verdict} →
      </span>
      <span className="text-fg-2">
        <ExpandableText head={t.head} rest={t.rest} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related instruments
// ---------------------------------------------------------------------------

// Each group states the job the other instrument does and what that means for
// obligations — the pattern worth keeping from the mock's framework-fit block.
interface RelatedGroup {
  role: string;
  effect: string;
  items: RelatedEntryWithKind[];
}

function buildGroups(data: EntryDetailResponse): RelatedGroup[] {
  const groups: RelatedGroup[] = [
    {
      role: "Authority",
      effect: "This instrument is made under it.",
      items: data.parentInstruments ?? [],
    },
    {
      role: "Pending amendment",
      effect: "Will change this text on commencement. Obligations still read here until then.",
      items: data.inFlightAmendments ?? [],
    },
    {
      role: "Folded in",
      effect: "Already amended this text. Its obligations are read here, not separately.",
      items: data.amendmentHistory ?? [],
    },
    {
      role: "Made under this",
      effect: "Delegated instruments carrying their own obligations. Read alongside.",
      items: data.relatedSubordinates ?? [],
    },
    {
      role: "Interprets this",
      effect: "Explains obligations rather than creating them.",
      items: data.relatedGuidance ?? [],
    },
    {
      role: "Replaced by",
      effect: "This instrument is no longer the live compliance surface.",
      items: data.supersededBy ?? [],
    },
    {
      role: "Replaces",
      effect: "Retired predecessors, kept for history.",
      items: data.supersedes ?? [],
    },
    {
      role: "Cross-referenced",
      effect: "Independent peers. Each carries its own obligations.",
      items: data.relatedInstruments ?? [],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

function RelatedSection({ data }: { data: EntryDetailResponse }) {
  const groups = buildGroups(data);
  if (groups.length === 0) return null;

  return (
    <Section title="Related instruments" kicker="and what each one does">
      <div className="divide-y divide-border border-t border-border">
        {groups.map((group) => (
          <div
            key={group.role}
            className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
                {group.role}
              </div>
              <p className="mt-1 text-[13px] leading-snug text-fg-3">{group.effect}</p>
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={`${item.id}-${item.kind}-${item.direction}`}>
                  <Link
                    href={`/tracker/${item.id}`}
                    className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover"
                  >
                    <StatusBadge status={item.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-fg transition-colors group-hover:text-accent">
                        {item.shortName}
                      </span>
                      <span className="block font-mono text-[11px] text-fg-3">
                        {ENTRY_TYPES.find((t) => t.value === item.type)?.label ?? item.type}
                      </span>
                    </span>
                    {item.nextKeyDate && (
                      <span className="flex-shrink-0 font-mono text-[12px] tabular-nums text-fg-3">
                        {formatDate(item.nextKeyDate)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}
