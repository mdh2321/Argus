"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Columns3, Loader2, Pin, ArrowRight, Check } from "lucide-react";
import { TopicMarkdown } from "@/components/library/topic-markdown";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";

const EXAMPLE_TOPICS = [
  "Data breach notification requirements",
  "E-signature validity and tiers",
  "AI governance obligations for financial institutions",
  "Cross-border data transfer restrictions",
];

interface ComparisonResult {
  topic: string;
  markdown: string;
  entryIds: string[];
}

export default function ComparePage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  async function generate(t: string) {
    const trimmed = t.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setResult(null);
    setPinnedId(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  async function pinToShelf() {
    if (!result || pinnedId) return;
    try {
      const res = await fetch("/api/library/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Comparison: ${result.topic}`,
          content: result.markdown,
          itemType: "comparison",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pin failed");
      setPinnedId(data.id);
      toast.success("Comparison pinned to the Shelf — frozen and dated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't pin this comparison");
    }
  }

  return (
    <div className="anim-enter">
      <div className="relative grid-pattern mb-8 py-4">
        <div className="relative z-10 flex items-center gap-2.5">
          <Columns3 className="h-5 w-5" style={{ color: "var(--teal)" }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">Compare</h1>
        </div>
        <p className="relative z-10 mt-1.5 max-w-xl text-[14px] text-fg-3">
          Side-by-side cross-jurisdiction comparison for any topic, grounded in the
          tracker. Copy it as markdown or pin it to the Shelf as a dated snapshot.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          generate(topic);
        }}
        className="mb-4 flex items-center gap-2"
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic to compare across jurisdictions…"
          maxLength={200}
          className="h-11 flex-1 rounded-xl border border-border bg-surface px-4 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-border-hover"
        />
        <button
          type="submit"
          disabled={loading || !topic.trim()}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-[13px] font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Compare
        </button>
      </form>

      {!result && !loading && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_TOPICS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTopic(t);
                generate(t);
              }}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-[11px] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-fg-3" />
          <p className="text-[13px] text-fg-3">
            Reading the tracker corpus and building the comparison — usually under a minute.
          </p>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">
              Generated {new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
              {result.entryIds.length > 0 && ` · grounded in ${result.entryIds.length} tracker entries`}
            </span>
            <div className="flex items-center gap-1">
              <CopyMarkdownButton getMarkdown={() => result.markdown} />
              {pinnedId ? (
                <Link
                  href="/library/shelf"
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] font-medium text-[var(--green)] transition-colors hover:bg-hover"
                >
                  <Check className="h-3 w-3" />
                  On the Shelf →
                </Link>
              ) : (
                <button
                  onClick={pinToShelf}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] font-medium text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
                >
                  <Pin className="h-3 w-3" />
                  Pin to Shelf
                </button>
              )}
            </div>
          </div>
          <TopicMarkdown content={result.markdown} />
        </div>
      )}
    </div>
  );
}
