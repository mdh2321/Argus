import {
  Landmark,
  FilePen,
  ScrollText,
  Layers,
  ShieldCheck,
  Lightbulb,
  Gavel,
  Siren,
  MessagesSquare,
  Compass,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { AUTHORITY_LEVELS, authorityForType, ENTRY_TYPES } from "@/lib/constants";

// One distinct glyph per instrument type. Shape identifies the *type*; the
// colour (below) encodes the derived *authority* tier. Together they let a
// reader tell "what kind of instrument" and "how binding" at a glance — e.g.
// when picking a source to scope an Ask.
const TYPE_ICON: Record<string, LucideIcon> = {
  legislation: Landmark, // an Act — the statute-book institution
  "amending-act": FilePen, // an act that edits another act
  bill: ScrollText, // a draft moving through the legislature
  regulation: Layers, // subordinate legislation — sits under a parent Act
  "binding-guidance": ShieldCheck, // enforceable regulator standard
  "interpretive-guidance": Lightbulb, // explanatory, non-binding
  "court-decision": Gavel, // judgment
  enforcement: Siren, // enforcement action / penalty
  consultation: MessagesSquare, // call for comment
  policy: Compass, // strategy / direction
};

// Authority tier → colour. Reuses the AUTHORITY_LEVELS palette so the icon
// colour matches the binding/expected/interpretive/informational vocabulary
// used elsewhere.
const AUTHORITY_COLOR: Record<string, string> = Object.fromEntries(
  AUTHORITY_LEVELS.map((a) => [a.value, a.color])
);

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ENTRY_TYPES.map((t) => [t.value, t.label])
);

export function instrumentTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/**
 * Icon for an instrument type. Colour is derived from the type's authority
 * tier by default; pass `tone="muted"` to inherit the surrounding text colour
 * (e.g. inside an already-muted meta line where colour would be noise).
 */
export function InstrumentTypeIcon({
  type,
  className = "w-3.5 h-3.5",
  tone = "authority",
  title,
}: {
  type: string;
  className?: string;
  tone?: "authority" | "muted";
  title?: string;
}) {
  const Icon = TYPE_ICON[type] ?? FileText;
  const color =
    tone === "authority"
      ? AUTHORITY_COLOR[authorityForType(type)] ?? "currentColor"
      : undefined;
  return (
    <Icon
      className={`${className} flex-shrink-0`}
      style={color ? { color } : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    />
  );
}
