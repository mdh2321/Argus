import Link from "next/link";
import type { DigestIssue } from "@/hooks/use-digest";
import { getFlag } from "@/lib/digest-utils";
import { TagBadge } from "./tag-badge";

function urgencyDotClass(urgency: string): string {
  switch (urgency) {
    case "immediate_action": return "bg-red";
    case "monitor_closely": return "bg-amber";
    default: return "bg-green";
  }
}

function topUrgency(issue: DigestIssue): string {
  if (issue.stories.some((s) => s.urgency === "immediate_action")) return "immediate_action";
  if (issue.stories.some((s) => s.urgency === "monitor_closely")) return "monitor_closely";
  return "awareness_only";
}

export function IssueCardCompact({ issue }: { issue: DigestIssue }) {
  const d = new Date(issue.date);
  const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const day = d.getDate();
  const flags = [...new Set(issue.stories.map((s) => s.jurisdictionCode).filter(Boolean))] as string[];
  const urgency = topUrgency(issue);

  return (
    <li className="group relative z-0 hover:z-50">
      <Link
        href={`/digest/issues/${issue.slug}`}
        className="grid items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-hover"
        style={{ gridTemplateColumns: "auto 1fr auto" }}
      >
        <div className="flex flex-col items-center text-center">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3">{dayOfWeek}</span>
          <span className="font-mono text-[10px] uppercase text-fg-3">{month}</span>
          <span className="font-mono text-lg font-semibold leading-tight text-fg">{day}</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">{flags.slice(0, 4).map((c) => getFlag(c)).join(" ")}</span>
            <p className="truncate text-[15px] font-semibold text-fg">{issue.title}</p>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[13px] text-fg-2">{issue.synopsis[0]}</p>
        </div>
        <div className={`h-2 w-2 rounded-full ${urgencyDotClass(urgency)}`} />
      </Link>

      {/* Hover popup */}
      <div className="pointer-events-none invisible absolute inset-x-0 top-full z-50 pt-2 group-hover:visible">
        <div className="rounded-xl border border-border-hover bg-[var(--bg)] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
          <ul className="mb-3 space-y-1">
            {issue.synopsis.map((s, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-fg-2">
                &bull; {s}
              </li>
            ))}
          </ul>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[...new Set(issue.stories.flatMap((s) => s.categories))].slice(0, 6).map((cat) => (
              <TagBadge key={cat} name={cat} size="sm" />
            ))}
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-fg-3">
            <span>{issue.jurisdictionCount} jurisdictions</span>
            <span>&middot;</span>
            <span>{issue.storyCount} stories</span>
            <span>&middot;</span>
            <span>{issue.readTime} min read</span>
          </div>
        </div>
      </div>
    </li>
  );
}

export function IssueCardFull({ issue }: { issue: DigestIssue }) {
  const d = new Date(issue.date);
  const dateLabel = d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const flags = [...new Set(issue.stories.map((s) => s.jurisdictionCode).filter(Boolean))] as string[];
  const allCategories = [...new Set(issue.stories.flatMap((s) => s.categories))];

  return (
    <Link
      href={`/digest/issues/${issue.slug}`}
      className="card-featured group block p-6"
    >
      <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-fg-3">
        <span>{dateLabel}</span>
        <span>&middot;</span>
        <span>{issue.readTime} min read</span>
      </div>
      <h3 className="mb-2 text-xl font-bold leading-tight text-fg transition-colors group-hover:text-accent">
        {issue.title}
      </h3>
      <div className="mb-3 flex items-center gap-1.5 text-sm">
        {flags.map((c) => <span key={c}>{getFlag(c)}</span>)}
      </div>
      <ul className="mb-4 space-y-1.5">
        {issue.synopsis.map((s, i) => (
          <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-fg-2">
            <span className="mt-1 text-accent">&bull;</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {allCategories.slice(0, 6).map((cat) => (
          <TagBadge key={cat} name={cat} size="sm" />
        ))}
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-fg-3">
        <span>{issue.jurisdictionCount} jurisdictions</span>
        <span>&middot;</span>
        <span>{issue.storyCount} stories</span>
        <span>&middot;</span>
        <span>{issue.readTime} min read</span>
      </div>
    </Link>
  );
}
