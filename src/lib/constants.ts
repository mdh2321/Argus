export const JURISDICTIONS = [
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
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

export const ENTRY_TYPES = [
  { value: "legislation", label: "Legislation" },
  { value: "amending-act", label: "Amending Act" },
  { value: "bill", label: "Bill" },
  { value: "regulation", label: "Regulation" },
  { value: "binding-guidance", label: "Binding Guidance" },
  { value: "interpretive-guidance", label: "Interpretive Guidance" },
  { value: "enforcement", label: "Enforcement" },
  { value: "court-decision", label: "Court Decision" },
  { value: "consultation", label: "Consultation" },
  { value: "policy", label: "Policy" },
] as const;

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
  { value: "monitoring", label: "Monitoring", color: "#6b7280" },
  { value: "proposed", label: "Proposed", color: "#6366f1" },
  { value: "consultation", label: "Consultation", color: "#06b6d4" },
  { value: "bill_introduced", label: "Bill Introduced", color: "#a855f7" },
  { value: "passed", label: "Passed", color: "#f59e0b" },
  { value: "in_force", label: "In Force", color: "#22c55e" },
  { value: "amended", label: "Amended", color: "#22c55e" },
  { value: "repealed", label: "Repealed", color: "#374151" },
  { value: "enforcement", label: "Enforcement", color: "#ef4444" },
] as const;

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
