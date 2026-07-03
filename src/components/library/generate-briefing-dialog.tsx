"use client";

import { useState } from "react";
import { X, Loader2, Sparkles } from "lucide-react";
import { generateBriefing } from "@/hooks/use-knowledge";
import { JURISDICTIONS, CATEGORIES } from "@/lib/constants";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
}

const PRESETS = [
  { label: "Past week", days: 7 },
  { label: "Past month", days: 30 },
  { label: "Past quarter", days: 90 },
];

// Default to the past month — the flagship "monthly regulatory update".
const DEFAULT_DAYS = 30;

function rangeForDays(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function GenerateBriefingDialog({ open, onOpenChange, onGenerated }: Props) {
  const defaults = rangeForDays(DEFAULT_DAYS);
  const [periodFrom, setPeriodFrom] = useState(defaults.from);
  const [periodTo, setPeriodTo] = useState(defaults.to);
  const [activeDays, setActiveDays] = useState<number | null>(DEFAULT_DAYS);
  const [jurisdiction, setJurisdiction] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function applyPreset(days: number) {
    const r = rangeForDays(days);
    setPeriodFrom(r.from);
    setPeriodTo(r.to);
    setActiveDays(days);
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      await generateBriefing({
        periodFrom,
        periodTo,
        jurisdiction: jurisdiction || undefined,
        category: category || undefined,
      });
      onGenerated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !loading && onOpenChange(false)} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-bg-surface p-6 shadow-l">
        <button
          onClick={() => !loading && onOpenChange(false)}
          className="absolute right-4 top-4 p-1 rounded-lg text-fg-3 hover:text-fg hover:bg-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} strokeWidth={1.5} />
          <h2 className="text-[16px] font-semibold text-fg">Generate Briefing</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label-mono mb-1.5 block">Period</label>
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => applyPreset(p.days)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 font-mono text-[11px] transition-colors ${
                    activeDays === p.days
                      ? "border-accent/40 bg-accent-bg text-accent"
                      : "border-border text-fg-3 hover:bg-hover hover:text-fg-2"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-mono mb-1.5 block">From</label>
              <input
                type="date"
                value={periodFrom}
                onChange={(e) => {
                  setPeriodFrom(e.target.value);
                  setActiveDays(null);
                }}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-[13px] text-fg focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="label-mono mb-1.5 block">To</label>
              <input
                type="date"
                value={periodTo}
                onChange={(e) => {
                  setPeriodTo(e.target.value);
                  setActiveDays(null);
                }}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-[13px] text-fg focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="label-mono mb-1.5 block">Jurisdiction (optional)</label>
            <select
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-[13px] text-fg focus:border-accent focus:outline-none"
            >
              <option value="">All jurisdictions</option>
              {JURISDICTIONS.map((j) => (
                <option key={j.code} value={j.code}>{j.flag} {j.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-mono mb-1.5 block">Category (optional)</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-[13px] text-fg focus:border-accent focus:outline-none"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-[12px] text-red">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Briefing
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
