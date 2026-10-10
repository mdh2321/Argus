// Tracked jurisdictions. This is the single source of truth: filter bars, the
// horizon rows, scan/capture/gap AI validation and the digest reference
// extractor all derive their valid-code set from here. Order is display order
// only — no consumer depends on index. "China (Mainland)" is named explicitly
// because mainland PRC and Hong Kong SAR are separate legal systems and an
// instrument in one says nothing about the other.
export const JURISDICTIONS = [
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "CN", name: "China (Mainland)", flag: "🇨🇳" },
  { code: "HK", name: "Hong Kong SAR", flag: "🇭🇰" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
] as const;

export const CATEGORIES = [
  "Privacy & Data Protection",
  "AI & Emerging Technology",
  "Electronic Signatures & Transactions",
  "Commercial & Contract Law",
  "Consumer Protection",
  "Corporations & Governance",
  "Employment & Workplace",
  "Anti-Corruption & Bribery",
  "Modern Slavery & Supply Chain",
  "Outsourcing & Procurement",
  "Sustainability & ESG",
  "Data Security & Breach Notification",
] as const;

// Instrument types. `value` is the stored key (never rename a value without a
// data migration); `label` is display-only. Note: "regulation" is stored as-is
// for back-compat but labelled "Subordinate legislation" — the umbrella term
// (regulations, rules, orders, determinations, legislative instruments) that
// reads correctly across the Commonwealth-style jurisdictions we cover. We
// avoid "secondary legislation" because primary/secondary collides with the
// primary-vs-secondary *source* distinction (that lives on the anchor/satellite
// source role, not the instrument type).
export const ENTRY_TYPES = [
  { value: "legislation", label: "Act" },
  { value: "amending-act", label: "Amending Act" },
  { value: "bill", label: "Bill" },
  { value: "regulation", label: "Subordinate legislation" },
  { value: "binding-guidance", label: "Binding Guidance" },
  { value: "interpretive-guidance", label: "Interpretive Guidance" },
  { value: "enforcement", label: "Enforcement Action" },
  { value: "court-decision", label: "Court Decision" },
  { value: "consultation", label: "Consultation" },
  { value: "policy", label: "Policy" },
] as const;

// Instrument types grouped by legal character. The group ordering is also the
// canonical rank for "sort by type" and for rendering <optgroup>s. The grouping
// deliberately encodes bindingness (statute/subordinate/binding-guidance/
// decisions are binding; the rest are expected or informational) so a single
// type axis carries the authority signal — no separate authority selector.
export const ENTRY_TYPE_GROUPS = [
  { key: "statute", label: "Statute", types: ["legislation", "amending-act", "bill"] },
  { key: "subordinate", label: "Subordinate legislation", types: ["regulation"] },
  { key: "regulator", label: "Regulator instruments", types: ["binding-guidance", "interpretive-guidance"] },
  { key: "decisions", label: "Decisions & actions", types: ["court-decision", "enforcement"] },
  { key: "predecisional", label: "Pre-decisional", types: ["consultation", "policy"] },
] as const;

// Flat rank derived from group order — instruments sort by legal weight, not
// alphabetically. Lower = higher up the hierarchy.
export const ENTRY_TYPE_RANK: Record<string, number> = Object.fromEntries(
  ENTRY_TYPE_GROUPS.flatMap((g) => g.types).map((t, i) => [t, i])
);

// Subset of ENTRY_TYPES that can be tracker subjects on their own.
// Court decisions, enforcement actions, and interpretive guidance are events
// or commentary about underlying laws — they are not tracked independently.
// Amending acts are tracked while in-flight; on commencement they auto-archive
// into the parent's amendment history.
export const TRACKABLE_ENTRY_TYPES = [
  "legislation",
  "amending-act",
  "bill",
  "regulation",
  "binding-guidance",
] as const;

// Authority weight orthogonal to type. Drives the binding-vs-guidance
// indicator in the list and lets users filter "what must I comply with".
export const AUTHORITY_LEVELS = [
  { value: "binding", label: "Binding", color: "#22c55e" },
  { value: "expected", label: "Expected", color: "#f59e0b" },
  { value: "interpretive", label: "Interpretive", color: "#06b6d4" },
  { value: "informational", label: "Informational", color: "#6b7280" },
] as const;

// Default authority level inferred from type. Used for backfill and as the
// fallback when an entry has no explicit authority_level.
export const TYPE_DEFAULT_AUTHORITY: Record<string, AuthorityLevel> = {
  "legislation": "binding",
  "amending-act": "binding",
  "regulation": "binding",
  "binding-guidance": "binding",
  "enforcement": "binding",
  "court-decision": "binding",
  "interpretive-guidance": "expected",
  "policy": "expected",
  "bill": "informational",
  "consultation": "informational",
};

// Single source of truth for an instrument's authority. Authority is a pure
// function of type (verified: no row in the corpus diverges from its type
// default), so we derive it rather than storing/filtering it as an independent
// axis. `stored` lets callers honour an explicit override if one is ever set,
// but the type default is the norm.
export function authorityForType(
  type: string,
  stored?: string | null
): AuthorityLevel {
  return (stored ?? TYPE_DEFAULT_AUTHORITY[type] ?? "informational") as AuthorityLevel;
}

// Typed relationship kinds. See schema.ts/entryRelationships for direction
// semantics (from = dependent, to = principal).
export const RELATIONSHIP_KINDS = [
  { value: "subordinate_to", label: "Made under", verb: "Made under" },
  { value: "amends", label: "Amends", verb: "Amends" },
  { value: "interprets", label: "Guidance on", verb: "Guidance on" },
  { value: "implements", label: "Implements", verb: "Implements" },
  { value: "supersedes", label: "Replaces", verb: "Replaces" },
  { value: "references", label: "References", verb: "References" },
] as const;

export const STATUSES = [
  // Legacy ingestion used `monitoring` as a fallback when lifecycle was
  // unknown. Keep the stored value for compatibility, but present it honestly
  // as a data-quality state rather than a legislative lifecycle stage.
  { value: "monitoring", label: "Status Unclassified", color: "#6b7280" },
  { value: "proposed", label: "Proposed", color: "#6366f1" },
  { value: "consultation", label: "Consultation", color: "#06b6d4" },
  { value: "bill_introduced", label: "Bill Introduced", color: "#a855f7" },
  { value: "passed", label: "Passed", color: "#f59e0b" },
  // Some provisions have commenced, others have not. An amendment in this state
  // flags its parent(s) as partially amended but stays live until full
  // commencement (staged-commencement handling).
  { value: "partially_in_force", label: "Partially In Force", color: "#84cc16" },
  { value: "in_force", label: "In Force", color: "#22c55e" },
  // Non-legislative instruments such as regulator guidance can be operative
  // without technically being "in force".
  { value: "current", label: "Current", color: "#22c55e" },
  { value: "amended", label: "Amended", color: "#22c55e" },
  // An in-flight bill / amendment / consultation that was withdrawn or died
  // before commencing. Terminal — any staleness it imposed on a parent is
  // cleared and it leaves the active watchlist.
  { value: "lapsed", label: "Lapsed", color: "#57534e" },
  { value: "repealed", label: "Repealed", color: "#374151" },
  // Retired because a newer instrument replaced it (repeal-and-replace). Kept
  // for history / point-in-time; not a live compliance surface.
  { value: "superseded", label: "Superseded", color: "#44403c" },
  { value: "enforcement", label: "Enforcement", color: "#ef4444" },
] as const;

// Broad lifecycle buckets used by the Tracker library. `monitoring` is
// deliberately absent: unclassified records remain discoverable in All and
// through the precise Status filter, but are not guessed into Live/Upcoming.
export const LIVE_ENTRY_STATUSES = [
  "partially_in_force",
  "in_force",
  "current",
  "amended",
  "enforcement",
] as const;

export const UPCOMING_ENTRY_STATUSES = [
  "proposed",
  "consultation",
  "bill_introduced",
  "passed",
] as const;

export type TrackerLifecycle = "all" | "live" | "upcoming";

// Canonical deadline-urgency tokens (G3). Urgency is the most safety-critical
// signal and renders across the deadlines API, horizon, dashboard, entry page
// and timeline — every surface must map an urgency to the SAME colour/label so
// "imminent" is never amber in one place and red in another. Buckets match
// calculateUrgency() in utils.ts.
export const URGENCY = {
  overdue: { label: "Overdue", color: "var(--red)" },
  imminent: { label: "Imminent", color: "var(--amber)" },
  upcoming: { label: "Upcoming", color: "var(--accent)" },
  future: { label: "Future", color: "var(--fg-3)" },
} as const;

export type Urgency = keyof typeof URGENCY;

export const IMPACT_LABELS: Record<number, string> = {
  1: "Minimal",
  2: "Low",
  3: "Moderate",
  4: "High",
  5: "Critical",
};

export const IMPACT_COLORS: Record<number, string> = {
  1: "#6b7280",
  2: "#06b6d4",
  3: "#f59e0b",
  4: "#f97316",
  5: "#ef4444",
};

export const SOURCE_TIERS = [
  { value: "primary_legislation", label: "Primary Legislation", color: "#22c55e" },
  { value: "regulator", label: "Regulator", color: "#3b82f6" },
  { value: "legal_commentary", label: "Legal Commentary", color: "#8b5cf6" },
  { value: "industry", label: "Industry", color: "#f59e0b" },
  { value: "media", label: "Media", color: "#6b7280" },
  { value: "model_knowledge", label: "Model Knowledge", color: "#ef4444" },
] as const;

export const CONFIDENCE_LEVELS = [
  { value: "high", label: "High", color: "#22c55e" },
  { value: "medium", label: "Medium", color: "#f59e0b" },
  { value: "low", label: "Low", color: "#ef4444" },
] as const;

export type JurisdictionCode = (typeof JURISDICTIONS)[number]["code"];
export type Category = (typeof CATEGORIES)[number];
export type EntryType = (typeof ENTRY_TYPES)[number]["value"];
export type Status = (typeof STATUSES)[number]["value"];
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number]["value"];
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number]["value"];
