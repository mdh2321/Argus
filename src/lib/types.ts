export type SourceTier = 'primary_legislation' | 'regulator' | 'legal_commentary' | 'industry' | 'media' | 'model_knowledge';

export interface TrackerSource {
  url: string;
  label?: string;
  tier: SourceTier;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface SectionConfidence {
  level: ConfidenceLevel;
  basis: string;
}

export type ClaimGrounding = "direct_quote" | "paraphrase" | "inference" | "ai_knowledge";
export type EntrySectionKey =
  | "summary"
  | "applicability"
  | "keyCriteria"
  | "whyItMatters"
  | "complianceImplications"
  | "exemptions"
  | "penalties"
  | "openQuestions"
  | "relatedContext";

export interface EntryClaimCitation {
  sourceDocumentId?: string | null;
  sourceDocumentName?: string | null;
  sourceUrl?: string | null;
  sectionRef?: string | null;
  groundingType?: ClaimGrounding;
  note?: string | null;
  // Exact-quote anchoring (P1.2). When groundingType is "direct_quote" and the
  // verbatim quote was located in the source document's fullText, `quote` holds
  // the passage and quoteStart/quoteEnd its character offsets — enabling a
  // guaranteed pinpoint highlight instead of the best-effort section scroll.
  // quoteVerified is true only on an exact string match; a failed match
  // downgrades the claim to "paraphrase" and leaves these null.
  quote?: string | null;
  quoteStart?: number | null;
  quoteEnd?: number | null;
  quoteVerified?: boolean | null;
}

export interface EntryClaim {
  text: string;
  citation?: EntryClaimCitation | null;
}

export type EntrySectionClaims = Partial<Record<EntrySectionKey, EntryClaim[]>>;

export interface EntrySectionConfidence {
  summary?: SectionConfidence;
  applicability?: SectionConfidence;
  keyCriteria?: SectionConfidence;
  whyItMatters?: SectionConfidence;
  complianceImplications?: SectionConfidence;
  exemptions?: SectionConfidence;
  penalties?: SectionConfidence;
  openQuestions?: SectionConfidence;
  relatedContext?: SectionConfidence;
  notes?: SectionConfidence;
}

export type SummaryStatus = "idle" | "running" | "failed";

// Depth of the most recent summary generation. 'preliminary' = single-shot
// AI-knowledge analysis run when no source docs are attached. 'full' = the
// 4-stage source-grounded pipeline. The UI flags preliminary entries so
// readers know to take the analysis with a grain of salt.
export type SummaryDepth = "preliminary" | "full";

// Per-artifact on-demand generators. Each runs independently of the bundled
// summary pipeline so the UI can offer NotebookLM-style "create this artifact"
// triggers rather than producing every output by default.
export type ArtifactKind =
  | "complianceChecklist"
  | "thresholdTests"
  | "escalationTriggers"
  | "crossJurisdictionAnalogues";

export interface ArtifactJobState {
  status: SummaryStatus;
  startedAt: string | null;
  error: string | null;
}

export type AnalysisJobs = Partial<Record<ArtifactKind, ArtifactJobState>>;

// Phase 5.1 — practitioner outputs.
export interface EscalationTrigger {
  trigger: string; // Plain-language event/condition that raises urgency
  condition: string; // What the user should do or watch for when it fires
  sectionRef: string | null; // Where this is grounded in the source, if applicable
}

export interface ComplianceChecklistItem {
  action: string; // Concrete required action
  owner: string; // Who in the user's org typically owns this (Legal, Security, HR, etc.)
  evidence: string; // What demonstrates compliance (record, log, audit artefact)
  sectionRef: string | null; // Pinpoint citation
}

// "Threshold tests" — a flat ordered Q&A that walks through the in-scope test
// for the user's situation. Cleaner than a recursive tree and renders as a
// numbered list in the UI.
export interface ThresholdTest {
  question: string; // e.g. "Do you process personal information?"
  sectionRef: string | null; // Where the test lives in the source, if applicable
  ifYes: string; // What the answer means / next step
  ifNo: string; // Same for "no"
}

export interface Entry {
  id: string;
  jurisdiction: string;
  category: string;
  type: string;
  status: string;
  shortName: string;
  fullName: string;
  // Lawyer-style formal citation, e.g. "Privacy Act 1988 (Cth)" — rendered
  // under the title for quick copy-paste into memos.
  formalCitation: string | null;
  summary: string | null;
  applicability: string | null;
  keyCriteria: string | null;
  whyItMatters: string | null;
  // Satellite delta fields (§2.3). Only one is populated, per relationship kind:
  // whatItChanges (amendments), whatItClarifies (guidance), outcome (enforcement
  // / court). Null on anchors.
  whatItChanges: string | null;
  whatItClarifies: string | null;
  outcome: string | null;
  // Dual impact lenses: direct effect on the company vs. pass-through effect
  // on the company's customers. Short (1-3 sentence) fields.
  impactOnUs: string | null;
  impactOnCustomers: string | null;
  complianceImplications: string | null;
  exemptions: string | null;
  penalties: string | null;
  maxPenaltyValue: number | null;
  maxPenaltyCurrency: string | null;
  keyDates: KeyDate[] | null;
  nextKeyDate: string | null;
  impactScore: number | null;
  sourceUrls: TrackerSource[] | null;
  regulator: string | null;
  parentEntryId: string | null;
  relatedEntries: string[] | null;
  // Authority weight orthogonal to type. See constants.AUTHORITY_LEVELS.
  // Null on legacy rows; treat null as the type's default (TYPE_DEFAULT_AUTHORITY).
  authorityLevel: string | null;
  tags: string[] | null;
  notes: string | null;
  flagged: boolean;
  openQuestions: string | null;
  relatedContext: string | null;
  sectionConfidence: EntrySectionConfidence | null;
  sectionClaims: EntrySectionClaims | null;
  // Phase 5.1 practitioner outputs.
  escalationTriggers: EscalationTrigger[] | null;
  complianceChecklist: ComplianceChecklistItem[] | null;
  thresholdTests: ThresholdTest[] | null;
  // Background-job state for the generate-summary pipeline.
  summaryStatus: SummaryStatus;
  summaryError: string | null;
  summaryStartedAt: string | null;
  // Per-artifact background-job state. Keyed by ArtifactKind. Missing key =
  // never run (treat as idle).
  analysisJobs: AnalysisJobs | null;
  // Depth of the most recent summary generation. Drives the "preliminary"
  // banner. null = no summary has been generated.
  summaryDepth: SummaryDepth | null;
  // Set when the current analysis is known to predate a material change (most
  // commonly an amending instrument taking force — A2). null = current.
  analysisStaleReason: string | null;
  aiGenerated: boolean;
  archived: boolean;
  lastReviewed: string | null;
  createdAt: string;
  updatedAt: string;
  // List-view denormalizations. Populated by the entries list endpoint:
  //  - `parentShortName` on flat list rows that have a parent (for breadcrumb).
  //  - `parentRelationshipKind` — the typed relationship kind to the parent
  //    (e.g. "subordinate_to", "amends", "interprets"). Drives the breadcrumb
  //    verb ("Made under" / "Amends" / "Guidance on"). Null for unmigrated rows.
  //  - `children` on nested list rows (top-level entries get their kids inlined).
  parentShortName?: string | null;
  parentRelationshipKind?: string | null;
  children?: Entry[];
  // Anchor/satellite classification (plan §2.1-2.2). Populated by the list
  // endpoint. `anchorRole` distinguishes compliance-surface anchors from the
  // satellites that hang off them; `satelliteActivity` summarises an anchor's
  // linked satellites for the anchor-centric list row.
  anchorRole?: AnchorRole;
  satelliteActivity?: SatelliteActivity | null;
  // Soft validation flag (§2.1): a satellite with no anchor link. Advisory only.
  missingAnchor?: boolean;
}

export type AnchorRole = "anchor" | "satellite";

// Roll-up of an anchor's linked satellites, for the anchor-centric list row.
export interface SatelliteActivity {
  total: number;
  inFlightAmendments: number; // `amends` satellites not yet in_force
  guidanceCount: number; // `interprets` satellites
  latestUpdatedAt: string | null;
  line: string; // e.g. "1 bill in flight · guidance updated 3d ago"
}

// What kind of action a dated milestone demands (Horizon typing, Jul 2026):
//   compliance — an obligation lands: in force, applies, transition ends
//   process    — a window to act closes: consultation, submissions, hearing
//   watch      — an event to monitor: expected publication, decision, passage
export type DeadlineKind = "compliance" | "process" | "watch";

export interface KeyDate {
  date: string;
  label: string;
  // Optional: set by AI extraction/capture going forward; legacy dates are
  // classified from the label at read/sync time.
  kind?: DeadlineKind | null;
  // Where in the source the date comes from (e.g. "s 2", "cl 14") — set by
  // the extract-dates pass so dates stay auditable.
  sectionRef?: string | null;
}

export interface EntryChange {
  id: string;
  entryId: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  changeSummary: string | null;
  changedBy: string;
  sourceUrl: string | null;
  sectionRef: string | null;
  sourceSnapshotId: string | null;
  changedAt: string;
  status: "proposed" | "applied" | "dismissed";
}

export interface Deadline {
  id: string;
  entryId: string;
  date: string;
  label: string;
  urgency: string;
  kind: DeadlineKind;
}

export interface DeadlineItem extends Deadline {
  entryShortName: string;
  entryJurisdiction: string;
  entryImpactScore: number | null;
  entryStatus: string;
  entryRegulator: string | null;
}

export interface UpdateRun {
  id: string;
  runAt: string;
  entriesCreated: number;
  entriesUpdated: number;
  sourcesChecked: string[] | null;
  modelUsed: string | null;
  costEstimate: number | null;
}

export interface SourceDocument {
  id: string;
  entryId: string;
  name: string;
  sourceUrl: string | null;
  fullText: string | null;
  fileType: string | null;
  charCount: number | null;
  addedBy: string;
  role: SourceDocumentRole | null;
  sourceAuthority: SourceAuthority | null;
  verifiedUrl: boolean;
  lastUrlCheck: string | null;
  contentHash: string | null;
  retrievedAt: string | null;
  fetchStatus: SourceDocumentFetchStatus | null;
  fetchError: string | null;
  extractor: string | null;
  createdAt: string;
  updatedAt: string;
}

// 'primary_text' = the instrument itself (ground-truth legal text, one per
// entry); 'supporting' = memoranda, guidance, analysis, news.
export type SourceDocumentRole = "primary_text" | "supporting";

export interface SourceDocumentVersion {
  id: string;
  sourceDocId: string;
  entryId: string;
  contentHash: string | null;
  fullText: string | null;
  charCount: number | null;
  retrievedAt: string | null;
  trigger: "refresh" | "amendment";
  createdAt: string;
}

export type SourceDocumentFetchStatus = "ok" | "no_text" | "fetch_failed" | "manual";

export type SourceAuthority = "official_legislation" | "official_regulator" | "law_firm_analysis" | "news" | "academic" | "unknown";
// June 2026 library rebuild: the library is exactly two kinds of things —
// the topics wiki (itemType 'topic'; living, compiled, never hand-authored)
// and the shelf (frozen, dated artifacts: 'briefing', 'pinned_answer', and
// later 'comparison' tables from the comparator). The legacy types (concept,
// entity, trend) remain in the union so old rows still deserialize, but no
// creation path produces them.
export type KnowledgeItemType =
  | "topic"
  | "briefing"
  | "pinned_answer"
  | "concept"
  | "comparison"
  | "entity"
  | "trend";
export type KnowledgeConfidence = "high" | "medium" | "low" | "unverified";
export type KnowledgeGrounding = "sources" | "entries" | "ai_knowledge" | "mixed";
export type KnowledgeStatus = "current" | "stale" | "needs_review" | "disputed" | "retired";
export type GroundingType = "direct_quote" | "paraphrase" | "inference" | "ai_knowledge";

export interface KnowledgeItem {
  id: string;
  slug: string;
  title: string;
  itemType: KnowledgeItemType;
  jurisdiction: string | null;
  category: string | null;
  content: string;
  contentHtml: string | null;
  confidence: KnowledgeConfidence;
  groundedIn: KnowledgeGrounding;
  sourceEntryIds: string[] | null;
  sourceDigestSlugs: string[] | null;
  sourceDocIds: string[] | null;
  claimCount: number;
  groundedClaimCount: number;
  groundingRatio: number;
  lastGenerated: string | null;
  lastVerified: string | null;
  staleAfterDays: number;
  staleTriggerIds: string[] | null;
  status: KnowledgeStatus;
  periodFrom: string | null;
  periodTo: string | null;
  // Topic match terms (itemType='topic' only).
  topicTerms: string[] | null;
  autoRefresh: boolean;
  generationModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeClaim {
  id: string;
  knowledgeItemId: string;
  claimText: string;
  sourceDocId: string | null;
  sourceEntryId: string | null;
  sourceSection: string | null;
  groundingType: GroundingType;
  confidence: KnowledgeConfidence;
  disputed: boolean;
  disputeNote: string | null;
  createdAt: string;
}

export interface KnowledgeItemWithClaims extends KnowledgeItem {
  claims: KnowledgeClaim[];
  sourceEntries?: { id: string; shortName: string; jurisdiction: string }[];
}

export interface BriefingSection {
  heading: string;
  items: BriefingItem[];
}

export interface BriefingItem {
  claim: string;
  entryId?: string;
  entryName?: string;
  digestSlug?: string;
  knowledgeItemId?: string;
  confidence: KnowledgeConfidence;
  sourceAuthority: SourceAuthority | "mixed";
  sourceSection?: string;
}

export interface BriefingContent {
  sections: BriefingSection[];
  overallConfidence: KnowledgeConfidence;
  groundingRatio: number;
  entryCount: number;
  digestCount: number;
  sourceDocCount: number;
}

// ── Signals ────────────────────────────────────────────────────

export type SignalScope = "cross-jurisdiction" | "single-jurisdiction" | "thematic";
export type SignalTrendDirection = "accelerating" | "decelerating" | "stable" | "emerging" | "diverging";
export type SignalStatus = "active" | "stale" | "dismissed";

export interface Signal {
  id: string;
  title: string;
  summary: string;
  scope: SignalScope;
  trendDirection: SignalTrendDirection;
  confidence: KnowledgeConfidence;
  sourceEntryIds: string[] | null;
  sourceKnowledgeIds: string[] | null;
  sourceDigestStoryIds: string[] | null;
  jurisdictions: string[] | null;
  categories: string[] | null;
  status: SignalStatus;
  link: string | null;
  linkLabel: string | null;
  relevanceScore: number | null;
  relevanceRationale: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Gap Suggestions ────────────────────────────────────────────

export type GapSuggestionStatus = "pending" | "accepted" | "dismissed";
export type GapSuggestionSource = "digest" | "scan";

export interface GapSuggestion {
  id: string;
  suggestedShortName: string;
  suggestedFullName: string | null;
  suggestedJurisdiction: string;
  suggestedCategory: string;
  suggestedType: string | null;
  suggestedRegulator: string | null;
  rationale: string;
  sourceStoryId: string | null;
  sourceUrls: string[] | null;
  source: GapSuggestionSource;
  status: GapSuggestionStatus;
  acceptedEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined for display
  sourceStoryTitle?: string | null;
}

// ── User Profile ───────────────────────────────────────────────

export interface UserProfile {
  id: string;
  companyName: string | null;
  companyDescription: string | null;
  productsServices: string | null;
  sectors: string[] | null;
  jurisdictionsOfInterest: string[] | null;
  role: string | null;
  focusAreas: string[] | null;
  freeText: string | null;
  updatedAt: string;
}

export interface EntriesResponse {
  entries: Entry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface EntryRelated {
  id: string;
  shortName: string;
  type: string;
  status: string;
  jurisdiction: string;
  impactScore: number | null;
  nextKeyDate: string | null;
  createdAt: string;
}

export interface EntryRelationship {
  id: string;
  fromEntryId: string;
  toEntryId: string;
  kind: string; // RelationshipKind from constants
  createdAt: string;
}

// Entry-related summary alongside the relationship that produced it. Used to
// render the typed relationship sections on the detail page (subordinate
// instruments, guidance, amendment history, in-flight, supersession chain).
export interface RelatedEntryWithKind extends EntryRelated {
  kind: string; // RelationshipKind
  /** "outgoing" = this entry is the `from` (depends on the related); "incoming" = this entry is the `to` (the related depends on it). */
  direction: "outgoing" | "incoming";
}

export interface EntryDetailResponse {
  entry: Entry;
  changes: EntryChange[];
  // AI-proposed changes (A1) awaiting approve/dismiss on this entry.
  proposedChanges: EntryChange[];
  parentEntry: EntryRelated | null;
  childEntries: EntryRelated[];
  // Typed relationships, grouped by the section they render in.
  relatedSubordinates: RelatedEntryWithKind[]; // things made under this (incoming subordinate_to)
  relatedGuidance: RelatedEntryWithKind[]; // guidance/interpretation about this (incoming interprets)
  amendmentHistory: RelatedEntryWithKind[]; // amending acts that affected this (incoming amends; commenced ones)
  inFlightAmendments: RelatedEntryWithKind[]; // pending amending acts (incoming amends; not yet in_force)
  supersedes: RelatedEntryWithKind[]; // older versions this replaced (outgoing supersedes)
  supersededBy: RelatedEntryWithKind[]; // newer version that replaced this (incoming supersedes)
  // What this entry depends on (outgoing relationships).
  parentInstruments: RelatedEntryWithKind[]; // outgoing subordinate_to / amends / interprets / implements
}

export interface DeadlinesResponse {
  deadlines: DeadlineItem[];
}

// Cross-jurisdiction comparator (A4). On-demand AI comparison of a topic
// across the 7 tracked jurisdictions: a structured table with the dimensions
// that matter for the topic (thresholds, deadlines, penalties, …), plus a
// gaps/divergence synthesis. Generated from the entry corpus each time;
// saveable to the Shelf as a frozen `comparison` artifact.
export interface ComparisonRow {
  jurisdiction: string; // jurisdiction code (AU, NZ, …)
  tracked: boolean; // backed by at least one tracked entry
  entryIds: string[]; // tracker entries backing this row
  cells: Record<string, string>; // dimension label → value for this jurisdiction
}

export interface ComparisonResult {
  topic: string;
  headline: string; // one-line board-ready takeaway
  dimensions: string[]; // ordered column labels chosen for this topic
  rows: ComparisonRow[]; // one per jurisdiction, in canonical order
  gaps: string; // synthesis: divergences + where jurisdictions are silent
  markdown: string; // paste-ready (built server-side from the structure)
  generatedAt: string;
}

// One future key date on an active entry, with the context the Horizon page
// needs to render a row. labels for the same (entry, date) are merged
// server-side into a single `label`.
export interface HorizonItem {
  id: string;
  entryId: string;
  date: string;
  label: string;
  shortName: string;
  jurisdiction: string;
  category: string;
  status: string;
  impactScore: number | null;
  regulator: string | null;
  impactOnUs: string | null;
  impactOnCustomers: string | null;
  whyItMatters: string | null;
  kind: DeadlineKind;
}

export interface HorizonResponse {
  items: HorizonItem[];
  today: string;
}

export interface IngestRequest {
  entries: {
    action: "create" | "update";
    id?: string;
    data: Partial<Omit<Entry, "id" | "createdAt" | "updatedAt">>;
  }[];
  run_metadata?: {
    sources_checked?: string[];
    model_used?: string;
    cost_estimate?: number;
  };
}

export interface IngestResponse {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}
