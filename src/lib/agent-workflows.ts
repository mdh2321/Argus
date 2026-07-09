export type Workflow =
  | "summary"
  | "signals"
  | "briefing"
  | "knowledge"
  | "gap"
  | "reconcile"
  | "scan"
  | "ask"
  | "compare"
  | "ingest"
  | "artifact:complianceChecklist"
  | "artifact:thresholdTests"
  | "artifact:escalationTriggers"
  | "artifact:crossJurisdictionAnalogues";

const LABELS: Record<Workflow, string> = {
  summary: "Summary",
  signals: "Signals",
  briefing: "Briefing",
  knowledge: "Library",
  gap: "Gap suggestion",
  reconcile: "Reconciliation",
  scan: "Landscape scan",
  ask: "Ask",
  compare: "Comparator",
  ingest: "Ingest",
  "artifact:complianceChecklist": "Compliance checklist",
  "artifact:thresholdTests": "Threshold tests",
  "artifact:escalationTriggers": "Escalation triggers",
  "artifact:crossJurisdictionAnalogues": "Cross-jurisdiction analogues",
};

export function workflowLabel(w: Workflow | string | null | undefined): string {
  if (!w) return "Argus";
  return LABELS[w as Workflow] ?? String(w);
}
