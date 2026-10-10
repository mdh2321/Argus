"use client";

// Analysis — the same instrument through the company lens.
//
// Changes from v1:
//
//  • The compliance checklist is no longer its own "Required actions" section.
//    It is the operative half of "What we have to do", sitting directly under
//    the prose that explains why. One question, one answer.
//  • Checklist rows lead with the operative clause. The generator currently
//    emits 200-400 character actions that open "Audit and update…"; the row
//    shows the instruction, the pinpoint and the owner, with the rest on
//    demand. The real fix is upstream in the prompt — this keeps the page
//    readable until then.
//  • Escalation triggers are gone.
//  • Analyst notes close the tab: short, human, and last.

import type { ComplianceChecklistItem, EntryDetailResponse } from "@/lib/types";
import { ImpactIndicator } from "@/components/ui/impact-indicator";
import {
  Section,
  ClaimProse,
  Prose,
  CitationRef,
  condense,
  ExpandableText,
} from "./primitives";

export function AnalysisTab({ data }: { data: EntryDetailResponse }) {
  const entry = data.entry;
  const claims = entry.sectionClaims ?? {};
  const confidence = entry.sectionConfidence ?? {};
  const checklist = entry.complianceChecklist ?? [];

  const hasImpact = !!(entry.impactOnUs || entry.impactOnCustomers);
  const hasWhy = !!(entry.whyItMatters || claims.whyItMatters?.length);
  const hasRequirements = !!(
    entry.complianceImplications ||
    claims.complianceImplications?.length ||
    checklist.length
  );
  const hasNotes = !!(entry.notes || entry.openQuestions || claims.openQuestions?.length);

  if (!hasImpact && !hasWhy && !hasRequirements && !hasNotes) {
    return (
      <p className="text-[15px] text-fg-3">
        No company analysis has been generated for this entry yet.
      </p>
    );
  }

  return (
    <div className="space-y-11">
      {hasImpact && <ImpactSection data={data} />}

      {hasWhy && (
        <Section
          title="How it applies to us"
          confidence={confidence.whyItMatters}
        >
          <ClaimProse text={entry.whyItMatters} claims={claims.whyItMatters} />
        </Section>
      )}

      {hasRequirements && (
        <Section
          title="What we have to do"
          kicker={checklist.length ? `${checklist.length} requirements` : undefined}
          confidence={confidence.complianceImplications}
        >
          <div className="space-y-6">
            <ClaimProse
              text={entry.complianceImplications}
              claims={claims.complianceImplications}
              empty=""
            />
            {checklist.length > 0 && <RequirementList items={checklist} />}
          </div>
        </Section>
      )}

      {hasNotes && <NotesSection data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

function ImpactSection({ data }: { data: EntryDetailResponse }) {
  const entry = data.entry;
  return (
    <Section title="Impact" kicker="assessed only through the company lens">
      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
        <ImpactCell
          label="Direct impact"
          sublabel="direct legal and operational exposure"
          text={entry.impactOnUs}
          score={entry.impactScore}
        />
        <ImpactCell
          label="Indirect impact"
          sublabel="customer, product and contract exposure"
          text={entry.impactOnCustomers}
          score={null}
        />
      </div>
    </Section>
  );
}

function ImpactCell({
  label,
  sublabel,
  text,
  score,
}: {
  label: string;
  sublabel: string;
  text: string | null;
  score: number | null;
}) {
  return (
    <div className="bg-bg p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">{label}</h3>
        {score !== null && <ImpactIndicator score={score} showLabel />}
      </div>
      <p className="mb-2 text-[12px] leading-snug text-fg-3">{sublabel}</p>
      {text ? (
        <p className="text-[15px] leading-relaxed text-fg-2">{text}</p>
      ) : (
        <p className="text-[15px] italic leading-relaxed text-fg-3">Not yet assessed.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

function RequirementList({ items }: { items: ComplianceChecklistItem[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((item, i) => {
        const action = condense(item.action, 96);
        return (
          <li key={i} className="py-3">
            <div className="text-[16px] leading-relaxed text-fg">
              <ExpandableText head={action.head} rest={action.rest} />
              {item.sectionRef && (
                <CitationRef claim={{ text: "", citation: { sectionRef: item.sectionRef } }} />
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.05em] text-fg-3">
              <span>{item.owner || "Unassigned"}</span>
              {item.evidence && (
                <span className="normal-case tracking-normal text-fg-3">
                  Evidence: <EvidenceText text={item.evidence} />
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EvidenceText({ text }: { text: string }) {
  const e = condense(text, 72);
  return (
    <span className="font-sans text-[12px]">
      <ExpandableText head={e.head} rest={e.rest} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Analyst notes — short, human, last
// ---------------------------------------------------------------------------

// Open questions are capped: on a well-grounded entry the generator emits
// nine of them, which reads as hedging rather than as a watch list. The top
// few are the ones anyone acts on; the rest stay one click away.
const VISIBLE_QUESTIONS = 4;

function NotesSection({ data }: { data: EntryDetailResponse }) {
  const entry = data.entry;
  const claims = entry.sectionClaims ?? {};
  const questions = claims.openQuestions ?? [];

  return (
    <Section title="Analyst notes" kicker="open points and internal commentary">
      <div className="space-y-6 border-t border-border pt-5">
        {(questions.length > 0 || entry.openQuestions) && (
          <div>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">
              Open questions
            </h3>
            {questions.length > 0 ? (
              <OpenQuestions items={questions} />
            ) : (
              <Prose text={entry.openQuestions!} />
            )}
          </div>
        )}

        {entry.notes && (
          <div>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">
              Internal notes
            </h3>
            <Prose text={entry.notes} />
          </div>
        )}
      </div>
    </Section>
  );
}

function OpenQuestions({ items }: { items: NonNullable<EntryDetailResponse["entry"]["sectionClaims"]>["openQuestions"] }) {
  const claims = items ?? [];
  const [visible, hidden] = [claims.slice(0, VISIBLE_QUESTIONS), claims.slice(VISIBLE_QUESTIONS)];

  return (
    <>
      <ul className="space-y-2">
        {visible.map((claim, i) => {
          const q = condense(claim.text, 130);
          return (
            <li key={i} className="flex gap-2.5 text-[16px] leading-relaxed text-fg-2">
              <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-fg-3/50" />
              <span className="min-w-0">
                <ExpandableText head={q.head} rest={q.rest} />
                <CitationRef claim={claim} />
              </span>
            </li>
          );
        })}
      </ul>
      {hidden.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3 transition-colors hover:text-accent">
            {hidden.length} more
          </summary>
          <ul className="mt-2 space-y-2">
            {hidden.map((claim, i) => {
              const q = condense(claim.text, 130);
              return (
                <li key={i} className="flex gap-2.5 text-[16px] leading-relaxed text-fg-2">
                  <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-fg-3/50" />
                  <span className="min-w-0">
                    <ExpandableText head={q.head} rest={q.rest} />
                    <CitationRef claim={claim} />
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </>
  );
}
