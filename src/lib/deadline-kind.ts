import type { DeadlineKind } from "./types";

// Classify a key-date label into a DeadlineKind. Used as the fallback for
// legacy dates that predate the `kind` field (stored rows and keyDates JSON
// without one) — new dates get their kind from AI extraction or capture.
// Order matters: process words ("consultation closes") often co-occur with
// date-ish compliance words ("closes", "deadline"), so process is checked
// first; compliance next; anything else is an event to watch.
const PROCESS_RE =
  /consult|submission|comment|feedback|hearing|exposure draft|call for|respond|response due|review clos|rfi|invitation/i;
const COMPLIANCE_RE =
  /in force|into force|force date|commenc|effective|applies|application date|apply from|compliance|comply|deadline|transition|grace period|must |registration|obligation|enforce|mandatory|operative|repeal/i;

export function classifyDeadlineKind(label: string): DeadlineKind {
  if (PROCESS_RE.test(label)) return "process";
  if (COMPLIANCE_RE.test(label)) return "compliance";
  return "watch";
}

// Display metadata. Colors follow the app's fixed accent palette: compliance
// is the hard-obligation red, process is the act-now amber, watch is the
// informational cyan.
export const DEADLINE_KIND_META: Record<
  DeadlineKind,
  { label: string; color: string; description: string }
> = {
  compliance: {
    label: "Comply",
    color: "var(--red)",
    description: "An obligation lands on this date",
  },
  process: {
    label: "Act",
    color: "var(--amber)",
    description: "A window to respond closes on this date",
  },
  watch: {
    label: "Watch",
    color: "var(--cyan)",
    description: "An event to monitor, no action required yet",
  },
};

export const DEADLINE_KINDS: DeadlineKind[] = ["compliance", "process", "watch"];
