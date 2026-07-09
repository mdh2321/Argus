import {
  SOURCE_TIERS,
  CONFIDENCE_LEVELS,
  IMPACT_LABELS,
  IMPACT_COLORS,
} from "@/lib/constants";
import { Shield, Database, Bot, Layers, Clock, Eye } from "lucide-react";

export default function MethodologyPage() {
  return (
    <div className="anim-enter">
      <div className="relative mb-8 grid-pattern py-4">
        <div className="relative z-10 flex items-center gap-2.5">
          <Shield className="h-5 w-5" style={{ color: "var(--accent)" }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">
            Methodology
          </h1>
        </div>
        <p className="relative z-10 mt-1.5 max-w-2xl text-[14px] text-fg-3">
          How Argus collects, scores, and presents legal intelligence.
        </p>
      </div>

      <div className="space-y-6 max-w-3xl">
        {/* Source Hierarchy */}
        <Section
          icon={<Layers className="h-4 w-4" />}
          title="Source hierarchy"
        >
          <p className="mb-4 text-[14px] leading-relaxed text-fg-2">
            Every piece of information in Argus is tagged with a source tier.
            Higher-tier sources carry more weight in confidence scoring and
            recommendations.
          </p>
          <div className="space-y-2">
            {SOURCE_TIERS.map((tier, i) => (
              <div
                key={tier.value}
                className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-2.5"
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                  style={{ background: tier.color }}
                >
                  {i + 1}
                </span>
                <div>
                  <span className="text-[14px] font-medium text-fg">
                    {tier.label}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-fg-3">
                    {tierDescription(tier.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Trust & Confidence */}
        <Section
          icon={<Eye className="h-4 w-4" />}
          title="Confidence levels"
        >
          <p className="mb-4 text-[14px] leading-relaxed text-fg-2">
            Confidence reflects how well a claim or answer is grounded in
            authoritative sources. It is assigned per-response in Ask Argus
            and per-claim in deep reports.
          </p>
          <div className="flex flex-wrap gap-3">
            {CONFIDENCE_LEVELS.map((level) => (
              <div
                key={level.value}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg px-4 py-2.5"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: level.color }}
                />
                <span className="font-mono text-[12px] font-medium text-fg">
                  {level.label}
                </span>
                <span className="font-mono text-[11px] text-fg-3">
                  &mdash; {confidenceDescription(level.value)}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Impact Scoring */}
        <Section
          icon={<Database className="h-4 w-4" />}
          title="Impact scoring"
        >
          <p className="mb-4 text-[14px] leading-relaxed text-fg-2">
            Tracker entries are scored 1&ndash;5 for operational impact. This
            score drives dashboard sorting, urgency signals, and digest story
            ordering.
          </p>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3, 4, 5] as const).map((score) => (
              <div
                key={score}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded font-mono text-[11px] font-bold text-white"
                  style={{ background: IMPACT_COLORS[score] }}
                >
                  {score}
                </span>
                <span className="font-mono text-[12px] text-fg-2">
                  {IMPACT_LABELS[score]}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* AI Usage */}
        <Section icon={<Bot className="h-4 w-4" />} title="AI usage">
          <p className="mb-3 text-[14px] leading-relaxed text-fg-2">
            Argus uses Claude (Anthropic) for several capabilities:
          </p>
          <ul className="space-y-2">
            {[
              [
                "Ask Argus",
                "Answers legal-intelligence queries by searching across all tracked data, then synthesising a brief with linked citations.",
              ],
              [
                "Deep Reports",
                "Extended analysis with structured sections. Each claim is tagged with a grounding type so you can assess provenance.",
              ],
              [
                "Knowledge Generation",
                "Library items (summaries, briefings) are drafted by AI from tracker data and can be manually reviewed.",
              ],
              [
                "Signals",
                "Cross-cutting trends detected weekly by analysing tracker entries, digest stories, and library items together.",
              ],
              [
                "Digest Scoring",
                "Story urgency, impact, and categorisation are AI-assisted during digest generation.",
              ],
            ].map(([label, desc]) => (
              <li
                key={label}
                className="flex gap-3 rounded-lg border border-border bg-bg px-4 py-3"
              >
                <span className="mt-0.5 text-accent">&rarr;</span>
                <div>
                  <span className="text-[14px] font-medium text-fg">
                    {label}
                  </span>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">
                    {desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* Grounding Types */}
        <Section
          icon={<Shield className="h-4 w-4" />}
          title="Grounding types"
        >
          <p className="mb-4 text-[14px] leading-relaxed text-fg-2">
            In deep reports, every claim is annotated with how it relates to
            source material. This lets you quickly distinguish hard facts from
            AI-assisted inference.
          </p>
          <div className="space-y-2">
            {[
              {
                type: "Direct Quote",
                color: "var(--green)",
                desc: "Verbatim or near-verbatim from a tracked source.",
              },
              {
                type: "Paraphrase",
                color: "var(--cyan)",
                desc: "Restated from a specific source with the same meaning.",
              },
              {
                type: "Inference",
                color: "var(--amber)",
                desc: "Logical conclusion drawn from one or more sources.",
              },
              {
                type: "AI Knowledge",
                color: "var(--red)",
                desc: "Based on the model's training data, not a tracked source. Treat with caution.",
              },
            ].map((g) => (
              <div
                key={g.type}
                className="flex items-start gap-3 rounded-lg border border-border bg-bg px-4 py-3"
              >
                <span
                  className="mt-1.5 h-2 w-2 rounded-full flex-shrink-0"
                  style={{ background: g.color }}
                />
                <div>
                  <span className="text-[14px] font-medium text-fg">
                    {g.type}
                  </span>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">
                    {g.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Data Freshness */}
        <Section
          icon={<Clock className="h-4 w-4" />}
          title="Data freshness"
        >
          <p className="text-[14px] leading-relaxed text-fg-2">
            Tracker entries are maintained as the canonical source of truth for
            each regulatory development. Digest issues capture weekly news
            intake and feed new developments into the tracker. Library items
            provide synthesised analysis and briefings. Signals are regenerated
            periodically to reflect the latest cross-cutting trends.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-2">
            Trust badges (&ldquo;Stale&rdquo; and &ldquo;Needs Review&rdquo;)
            appear automatically on tracker entries that haven&rsquo;t been
            updated recently or that were AI-generated and haven&rsquo;t been
            manually reviewed, so you always know the provenance and freshness
            of the data you&rsquo;re reading.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-fg-3">{icon}</span>
        <h2 className="label-mono">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function tierDescription(value: string): string {
  const map: Record<string, string> = {
    primary_legislation: "Official gazette texts, enacted statutes",
    regulator: "Government agencies, regulatory bodies",
    legal_commentary: "Law firms, legal publications",
    industry: "Industry bodies, standards organisations",
    media: "News outlets, general press",
    model_knowledge: "AI training data (unverified)",
  };
  return map[value] || "";
}

function confidenceDescription(value: string): string {
  const map: Record<string, string> = {
    high: "Directly supported by primary or regulator sources",
    medium: "Supported by commentary or multiple secondary sources",
    low: "Limited sourcing or relies on model knowledge",
  };
  return map[value] || "";
}
