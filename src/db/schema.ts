import { sqliteTable, text, integer, real, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  id: text("id").primaryKey(),
  jurisdiction: text("jurisdiction").notNull(), // AU, NZ, SG, JP, HK, IN, PH
  category: text("category").notNull(),
  type: text("type").notNull(), // legislation, bill, regulation, binding-guidance, interpretive-guidance, enforcement, court-decision, consultation, policy
  status: text("status").notNull(), // monitoring, proposed, consultation, bill_introduced, passed, in_force, amended, repealed, enforcement
  shortName: text("short_name").notNull(),
  fullName: text("full_name").notNull(),
  summary: text("summary"),
  applicability: text("applicability"),
  keyCriteria: text("key_criteria"),
  whyItMatters: text("why_it_matters"),
  // Dual impact lenses — business relevance split into the two forms the
  // question actually arrives in: effect on the company directly, and effect
  // on the company's customers (pass-through, e.g. bank outsourcing rules
  // applying to customers who use the product). Short fields, 1-3 sentences.
  impactOnUs: text("impact_on_us"),
  impactOnCustomers: text("impact_on_customers"),
  complianceImplications: text("compliance_implications"),
  exemptions: text("exemptions"),
  penalties: text("penalties"),
  maxPenaltyValue: real("max_penalty_value"),
  maxPenaltyCurrency: text("max_penalty_currency"),
  keyDates: text("key_dates"), // JSON array of { date, label }
  nextKeyDate: text("next_key_date"), // denormalized for sorting
  impactScore: integer("impact_score"), // 1-5
  sourceUrls: text("source_urls"), // JSON array
  regulator: text("regulator"),
  relatedEntries: text("related_entries"), // JSON array of entry IDs
  tags: text("tags"), // JSON array
  notes: text("notes"),
  flagged: integer("flagged", { mode: "boolean" }).default(false),
  openQuestions: text("open_questions"),
  relatedContext: text("related_context"),
  sectionConfidence: text("section_confidence"), // JSON: EntrySectionConfidence
  sectionClaims: text("section_claims"), // JSON: EntrySectionClaims
  // Phase 5.1 practitioner outputs — derived once during analysis and rendered
  // as separate sections on the entry page.
  escalationTriggers: text("escalation_triggers"), // JSON: EscalationTrigger[]
  complianceChecklist: text("compliance_checklist"), // JSON: ComplianceChecklistItem[]
  thresholdTests: text("threshold_tests"), // JSON: ThresholdTest[]
  // Background-job state for the generate-summary pipeline. The route returns
  // immediately while the pipeline runs in the background; the UI polls these
  // fields. Values: 'idle' | 'running' | 'failed'.
  summaryStatus: text("summary_status").notNull().default("idle"),
  summaryError: text("summary_error"),
  summaryStartedAt: text("summary_started_at"),
  // Per-artifact background-job state for the on-demand generators (compliance
  // checklist, threshold tests, escalation triggers, cross-jurisdiction
  // analogues). JSON: Record<ArtifactKind, { status, startedAt, error }>.
  // Single column rather than 12 columns because the artifact set will grow.
  analysisJobs: text("analysis_jobs"),
  // Depth of the most recent summary generation. 'preliminary' = single-shot
  // model-knowledge analysis (no source docs); 'full' = 4-stage source-grounded
  // analysis. UI uses this to surface a "preliminary, regenerate for grounded
  // analysis" banner so readers don't mistake AI-knowledge claims for cited
  // legal analysis.
  summaryDepth: text("summary_depth"),
  // Set when the current analysis is known to predate a material change — most
  // commonly an amending instrument taking force (A2). Nullable; presence means
  // "regenerate for an up-to-date grounded analysis". Human-readable so it can
  // be shown verbatim in the staleness banner.
  analysisStaleReason: text("analysis_stale_reason"),
  // Formal citation in the lawyer's preferred format, e.g. "Privacy Act 1988
  // (Cth)", "Pub. L. 116-283", "Regulation (EU) 2016/679". Free-form because
  // citation conventions vary by jurisdiction and instrument type — better
  // to let the analyst (or AI) write it than to try to compose from fields.
  formalCitation: text("formal_citation"),
  aliases: text("aliases"), // JSON array — alternative names used to match references in digest stories
  parentEntryId: text("parent_entry_id").references((): AnySQLiteColumn => entries.id),
  // Authority weight independent of `type`. Lets users filter "binding only"
  // vs. "guidance" without overloading the type field. Derivable from `type`
  // for most entries but stored explicitly so exceptions are expressible.
  // Values: 'binding' | 'expected' | 'interpretive' | 'informational'.
  authorityLevel: text("authority_level"),
  // Satellite delta analysis (plan §2.3). Satellites carry the delta they
  // introduce rather than a second copy of the anchor's obligations:
  //   whatItChanges   — amending acts / bills that amend
  //   whatItClarifies — interpretive guidance / policy
  //   outcome         — enforcement actions / court decisions
  // Only the field matching the satellite's relationship is populated; anchors
  // leave all three null.
  whatItChanges: text("what_it_changes"),
  whatItClarifies: text("what_it_clarifies"),
  outcome: text("outcome"),
  aiGenerated: integer("ai_generated", { mode: "boolean" }).default(false),
  archived: integer("archived", { mode: "boolean" }).default(false),
  lastReviewed: text("last_reviewed"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Typed relationships between entries. Replaces the dual use of
// `parent_entry_id` (which couldn't distinguish "subordinate to" from "amends"
// from "interprets") and `related_entries` (which had no kind at all).
//
// Kinds:
//   subordinate_to  - regulation/notice made under an Act (Hash Rule → Privacy Act)
//   amends          - amending Act → principal Act (NDB Act → Privacy Act)
//   interprets      - guidance about another instrument (MAS Guidelines → MAS Notice)
//   implements      - domestic instrument giving effect to a treaty/directive
//   supersedes      - newer document replaces older (Notice 626 v2 → v1)
//   references      - soft cross-reference, no structural meaning
//
// Direction: `from` is the dependent / newer / interpreting entry; `to` is the
// principal / older / interpreted entry. e.g. for "NDB Act amends Privacy Act",
// from = NDB Act, to = Privacy Act.
export const entryRelationships = sqliteTable("entry_relationships", {
  id: text("id").primaryKey(),
  fromEntryId: text("from_entry_id").notNull().references((): AnySQLiteColumn => entries.id),
  toEntryId: text("to_entry_id").notNull().references((): AnySQLiteColumn => entries.id),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sourceDocuments = sqliteTable("source_documents", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull().references(() => entries.id),
  name: text("name").notNull(), // e.g. "Personal Data Protection Act 2012"
  sourceUrl: text("source_url"), // link to official legislation site
  fullText: text("full_text"), // the actual legislation text
  fileType: text("file_type"), // pdf, txt, html, etc.
  charCount: integer("char_count"), // for quick size reference
  addedBy: text("added_by").notNull().default("manual"), // "manual" | "ai"
  // Anchor/satellite evidence role. 'primary_text' = the instrument itself (the
  // ground-truth legal text — exactly one per instrument entry); 'supporting' =
  // explanatory memoranda, regulator guidance, analysis, news. Null on legacy
  // rows until backfilled or manually promoted. Drives the Sources panel split
  // ("The instrument" vs "Supporting materials") and instrument-text retrieval.
  role: text("role"), // 'primary_text' | 'supporting'
  // Trust layer
  sourceAuthority: text("source_authority"), // official_legislation, official_regulator, law_firm_analysis, news, academic, unknown
  verifiedUrl: integer("verified_url", { mode: "boolean" }).default(false),
  lastUrlCheck: text("last_url_check"),
  contentHash: text("content_hash"), // SHA256 of fullText
  retrievedAt: text("retrieved_at"),
  // Fetch outcome — surfaces whether the doc has usable text. Values:
  // "ok"            → text extracted, full analysis can use it
  // "no_text"       → URL reachable but extractor produced nothing (scanned PDF, JS-only page)
  // "fetch_failed"  → URL unreachable / blocked / 4xx-5xx
  // "manual"        → user pasted text directly, no fetch was attempted
  // null on legacy rows.
  fetchStatus: text("fetch_status"),
  fetchError: text("fetch_error"),
  extractor: text("extractor"), // "exa" | "direct-html" | "direct-pdf" | "direct-text" | null
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Point-in-time snapshots of a source document's full text. When
// `source-refresher` detects that an upstream instrument changed (content hash
// differs), it snapshots the OUTGOING text here before overwriting, so we can
// answer "what did this instrument say when we assessed it" and show a
// compilation timeline on the primary text. Only primary_text docs are worth
// versioning in practice, but the table isn't restricted — any doc can snapshot.
export const sourceDocumentVersions = sqliteTable("source_document_versions", {
  id: text("id").primaryKey(),
  sourceDocId: text("source_doc_id").notNull().references(() => sourceDocuments.id, { onDelete: "cascade" }),
  entryId: text("entry_id").notNull().references(() => entries.id),
  contentHash: text("content_hash"), // SHA256 of the snapshotted fullText
  fullText: text("full_text"), // the text as it read at retrievedAt
  charCount: integer("char_count"),
  // When this text was originally retrieved from source (the doc's retrievedAt
  // at snapshot time), not when the snapshot row was written.
  retrievedAt: text("retrieved_at"),
  // What caused the snapshot: 'refresh' (periodic/manual source check detected a
  // change) | 'amendment' (an amending instrument commenced — P2.4).
  trigger: text("trigger").notNull().default("refresh"),
  createdAt: text("created_at").notNull(),
});

// Defined terms extracted from a source document's definitions section. Most
// legislation hinges on statutory definitions ("personal information",
// "controller", "designated service"), so we extract them once per document
// and inject the relevant subset into every legal-analysis prompt. The model
// stops guessing what defined terms mean and uses the canonical text.
export const definedTerms = sqliteTable("defined_terms", {
  id: text("id").primaryKey(),
  sourceDocId: text("source_doc_id").notNull().references(() => sourceDocuments.id, { onDelete: "cascade" }),
  entryId: text("entry_id").notNull().references(() => entries.id),
  term: text("term").notNull(), // e.g. "personal information"
  definition: text("definition").notNull(), // the verbatim or near-verbatim definition text
  sectionRef: text("section_ref"), // where the definition lives, e.g. "s 6(1)"
  scope: text("scope").notNull().default("act-wide"), // act-wide, part-wide, section-specific
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const knowledgeItems = sqliteTable("knowledge_items", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  itemType: text("item_type").notNull(), // concept, comparison, entity, trend, briefing
  jurisdiction: text("jurisdiction"), // nullable — multi-jurisdiction items
  category: text("category"), // nullable
  content: text("content").notNull(), // compiled analysis text
  contentHtml: text("content_html"), // pre-rendered HTML for display
  // Trust layer
  confidence: text("confidence").notNull().default("unverified"), // high, medium, low, unverified
  groundedIn: text("grounded_in").notNull().default("ai_knowledge"), // sources, entries, ai_knowledge, mixed
  sourceEntryIds: text("source_entry_ids"), // JSON array
  sourceDigestSlugs: text("source_digest_slugs"), // JSON array
  sourceDocIds: text("source_doc_ids"), // JSON array
  claimCount: integer("claim_count").default(0),
  groundedClaimCount: integer("grounded_claim_count").default(0),
  groundingRatio: real("grounding_ratio").default(0),
  // Staleness
  lastGenerated: text("last_generated"),
  lastVerified: text("last_verified"),
  staleAfterDays: integer("stale_after_days").default(90),
  staleTriggerIds: text("stale_trigger_ids"), // JSON: entry IDs that, if updated, make this stale
  status: text("status").notNull().default("current"), // current, stale, needs_review, disputed, retired
  // Briefing-specific
  periodFrom: text("period_from"), // briefings: start of period
  periodTo: text("period_to"), // briefings: end of period
  // Topic-specific (itemType='topic'): JSON array of match terms. A tracker
  // entry / digest story / signal belongs to the topic when its category or
  // tags match any term. Membership is always queried live — only the
  // synthesized explainer is stored.
  topicTerms: text("topic_terms"),
  // Meta
  autoRefresh: integer("auto_refresh", { mode: "boolean" }).default(false),
  generationModel: text("generation_model"),
  generationPromptHash: text("generation_prompt_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const knowledgeClaims = sqliteTable("knowledge_claims", {
  id: text("id").primaryKey(),
  knowledgeItemId: text("knowledge_item_id").notNull(), // FK to knowledge_items.id (enforced at SQL level)
  claimText: text("claim_text").notNull(),
  sourceDocId: text("source_doc_id"), // FK to source_documents.id
  sourceEntryId: text("source_entry_id"), // FK to entries.id
  sourceSection: text("source_section"), // "Section 26(1)", "Part 3, Division 2"
  groundingType: text("grounding_type").notNull(), // direct_quote, paraphrase, inference, ai_knowledge
  confidence: text("confidence").notNull().default("medium"), // high, medium, low
  disputed: integer("disputed", { mode: "boolean" }).default(false),
  disputeNote: text("dispute_note"),
  createdAt: text("created_at").notNull(),
});

export const entryChanges = sqliteTable("entry_changes", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull().references(() => entries.id),
  fieldChanged: text("field_changed").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changeSummary: text("change_summary"),
  changedBy: text("changed_by").notNull(), // "ai" | "manual" | "system"
  sourceUrl: text("source_url"),
  sectionRef: text("section_ref"), // e.g. "Section 26(1)" — anchor inside the source
  sourceSnapshotId: text("source_snapshot_id"), // FK (logical) to source_documents.id
  changedAt: text("changed_at").notNull(),
  // Lifecycle of an AI-proposed change. Manual/system edits are written
  // straight as 'applied' (the historical default). Digest→entry reconciliation
  // (A1) writes 'proposed' rows that mutate nothing until approved, at which
  // point they flip to 'applied'; dismissing marks them 'dismissed'.
  status: text("status").notNull().default("applied"), // proposed | applied | dismissed
});

export const deadlines = sqliteTable("deadlines", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull().references(() => entries.id),
  date: text("date").notNull(),
  label: text("label").notNull(),
  urgency: text("urgency").notNull(), // overdue, imminent, upcoming, future
  // compliance | process | watch — see DeadlineKind. Nullable: legacy rows
  // are classified from the label at read time until their entry re-syncs.
  kind: text("kind"),
});

export const updateRuns = sqliteTable("update_runs", {
  id: text("id").primaryKey(),
  runAt: text("run_at").notNull(),
  entriesCreated: integer("entries_created").default(0),
  entriesUpdated: integer("entries_updated").default(0),
  sourcesChecked: text("sources_checked"), // JSON
  modelUsed: text("model_used"),
  costEstimate: real("cost_estimate"),
  workflow: text("workflow"), // summary | signals | briefing | knowledge | gap | ask | ingest
  profileSnapshot: text("profile_snapshot"), // JSON snapshot of userProfile at run time
});

// ── Digest ──────────────────────────────────────────────────────

export const digestIssues = sqliteTable("digest_issues", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  date: text("date").notNull(), // publication date YYYY-MM-DD
  weekOf: text("week_of").notNull(), // e.g. "17–21 Mar 2026"
  weekStart: text("week_start"), // ISO date, Monday — unique per week
  synopsis: text("synopsis"), // JSON array of strings
  storyCount: integer("story_count").default(0),
  jurisdictionCount: integer("jurisdiction_count").default(0),
  readTime: integer("read_time").default(5), // minutes
  status: text("status").notNull().default("published"), // draft, published, archived
  // Ingest pipeline outputs
  executiveBrief: text("executive_brief"),
  regulatoryRadar: text("regulatory_radar"),
  crossBorderWatch: text("cross_border_watch"),
  complianceScorecard: text("compliance_scorecard"), // JSON
  regionInsights: text("region_insights"),
  coverageGaps: text("coverage_gaps"), // JSON array of jurisdiction codes that failed
  ingestCostUsd: real("ingest_cost_usd"),
  ingestDurationMs: integer("ingest_duration_ms"),
  deliveredAt: text("delivered_at"), // set once email/telegram delivery succeeded
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const digestStories = sqliteTable("digest_stories", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").references(() => digestIssues.id), // null for standalone pulse items
  title: text("title").notNull(),
  url: text("url"),
  source: text("source").notNull(), // e.g. "Government Gazette", "LegalTech News"
  sourceType: text("source_type").notNull(), // regulator, law_firm, publication, court, community
  date: text("date").notNull(),
  summary: text("summary").notNull(),
  takeaways: text("takeaways"), // JSON array of strings
  // Cleaned article body captured at ingest (reuses the text Exa already
  // fetches for synthesis instead of discarding it). Grounds conversational
  // "Ask about this story" — the Gemini-upload equivalent. ~8k chars max.
  articleText: text("article_text"),
  jurisdiction: text("jurisdiction"), // nullable for non-jurisdiction-specific
  jurisdictionCode: text("jurisdiction_code"),
  categories: text("categories"), // JSON array
  contentType: text("content_type").notNull().default("regulatory"), // regulatory, tool-spotlight, use-case, community-thread, prompt-pattern, opinion, vendor-watch
  lifecycleStage: text("lifecycle_stage"), // Proposed, Consultation, Enacted, Effective, Enforced
  urgency: text("urgency"), // immediate_action, monitor_closely, awareness_only
  impact: text("impact"), // Low, Medium, High
  complianceDeadline: text("compliance_deadline"),
  trackerEntryId: text("tracker_entry_id").references(() => entries.id), // flywheel link
  featured: integer("featured", { mode: "boolean" }).default(false),
  // User's one-click star — a personal shortlist of "things to raise with the
  // business". Distinct from pipeline-set `featured`. Deliberately not a
  // workflow: no statuses, no owners.
  saved: integer("saved", { mode: "boolean" }).default(false),
  tags: text("tags"), // JSON array
  sourceChannel: text("source_channel"), // "rss" | "exa" | "anthropic" | "inbox"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Signals ────────────────────────────────────────────────────

export const signals = sqliteTable("signals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  scope: text("scope").notNull(), // cross-jurisdiction, single-jurisdiction, thematic
  trendDirection: text("trend_direction").notNull(), // accelerating, decelerating, stable, emerging, diverging
  confidence: text("confidence").notNull().default("medium"), // high, medium, low
  sourceEntryIds: text("source_entry_ids"), // JSON array
  sourceKnowledgeIds: text("source_knowledge_ids"), // JSON array
  sourceDigestStoryIds: text("source_digest_story_ids"), // JSON array
  jurisdictions: text("jurisdictions"), // JSON array
  categories: text("categories"), // JSON array
  status: text("status").notNull().default("active"), // active, stale, dismissed
  link: text("link"),
  linkLabel: text("link_label"),
  relevanceScore: integer("relevance_score"), // 0-100 — how relevant to this user's profile
  relevanceRationale: text("relevance_rationale"), // one-sentence "why for you"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Story References ───────────────────────────────────────────
//
// A digest story can reference one or more trackable subjects (legislation,
// regulation, binding-guidance). Each reference is a span of text in the
// story's summary plus a resolved or proposed entry.
//
// status:
//   - 'matched'    → entryId is set; reference resolves to an existing entry
//   - 'unmatched'  → entryId is null; user can accept to create a new entry
//                    pre-filled from the proposed_* fields
//   - 'dismissed'  → user explicitly dismissed (won't render)
//
// When a story references interpretive-guidance, extraction tries to identify
// the parent legislation. The reference resolves to the parent (entryId or
// proposed_*); the literal guidance text is stored in `text` for highlighting.

export const storyReferences = sqliteTable("story_references", {
  id: text("id").primaryKey(),
  storyId: text("story_id").notNull().references(() => digestStories.id),
  entryId: text("entry_id").references(() => entries.id),
  text: text("text").notNull(), // literal text as it appears in the story summary
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  proposedShortName: text("proposed_short_name"),
  proposedFullName: text("proposed_full_name"),
  proposedJurisdiction: text("proposed_jurisdiction"),
  proposedType: text("proposed_type"), // legislation | regulation | binding-guidance
  proposedRegulator: text("proposed_regulator"),
  proposedCategory: text("proposed_category"),
  parentProposal: text("parent_proposal"), // JSON, when the literal text was interpretive-guidance referring to a parent law
  matchConfidence: real("match_confidence"), // 0-1
  status: text("status").notNull().default("unmatched"), // matched | unmatched | dismissed
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Gap Suggestions ────────────────────────────────────────────

export const gapSuggestions = sqliteTable("gap_suggestions", {
  id: text("id").primaryKey(),
  suggestedShortName: text("suggested_short_name").notNull(),
  suggestedFullName: text("suggested_full_name"),
  suggestedJurisdiction: text("suggested_jurisdiction").notNull(),
  suggestedCategory: text("suggested_category").notNull(),
  suggestedType: text("suggested_type"), // legislation, bill, regulation, guidance, etc.
  suggestedRegulator: text("suggested_regulator"),
  rationale: text("rationale").notNull(), // why you should add this to your tracker
  sourceStoryId: text("source_story_id").references(() => digestStories.id),
  sourceUrls: text("source_urls"), // JSON array of primary source URLs
  source: text("source").notNull().default("digest"), // digest | scan — which pipeline produced this
  status: text("status").notNull().default("pending"), // pending, accepted, dismissed
  acceptedEntryId: text("accepted_entry_id").references((): AnySQLiteColumn => entries.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── User Profile ───────────────────────────────────────────────

export const userProfile = sqliteTable("user_profile", {
  id: text("id").primaryKey(),
  companyName: text("company_name"),
  companyDescription: text("company_description"),
  productsServices: text("products_services"),
  sectors: text("sectors"), // JSON array
  jurisdictionsOfInterest: text("jurisdictions_of_interest"), // JSON array
  role: text("role"),
  focusAreas: text("focus_areas"), // JSON array
  freeText: text("free_text"),
  updatedAt: text("updated_at").notNull(),
});

// ── Query Sessions ──────────────────────────────────────────────

export const querySessions = sqliteTable("query_sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const queryMessages = sqliteTable("query_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => querySessions.id),
  role: text("role").notNull(), // "user" or "assistant"
  content: text("content").notNull(),
  citedEntryIds: text("cited_entry_ids"), // JSON array
  // Full serialized answer (AskArgusAnswer / AskConversationalAnswer) for
  // assistant turns, so past conversations re-render with full fidelity. Null
  // for user turns and for sessions created before this column existed.
  answerJson: text("answer_json"),
  createdAt: text("created_at").notNull(),
});

// ── Matters (workstream bundles) ────────────────────────────────
// A Matter bundles tracker entries, digest stories, Ask threads and briefings
// around one workstream (e.g. "EU AI Act readiness"), with matter-specific
// instructions. The Spaces analog.

export const matters = sqliteTable("matters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions"), // steer Ask/analysis scoped to this matter
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const matterItems = sqliteTable("matter_items", {
  id: text("id").primaryKey(),
  matterId: text("matter_id").notNull().references(() => matters.id),
  kind: text("kind").notNull(), // "entry" | "story" | "thread" | "briefing" | "knowledge" | "signal"
  refId: text("ref_id").notNull(),
  label: text("label").notNull(), // denormalised title for display
  href: text("href").notNull(), // where the item lives
  addedAt: text("added_at").notNull(),
});
