"use client";

import { useEffect, useState } from "react";
import { CheckCircle, FileText, Save } from "lucide-react";

// Editor for data/company-context.md — the canonical company context every AI
// surface (digest triage, Ask, Scan, Capture, Signals…) reads. The profile
// form below is the fallback for installs without the file.
export function CompanyContextEditor() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/company-context")
      .then((r) => r.json())
      .then((d) => setContent(d.content ?? ""))
      .catch(() => setError("Couldn't load company context file"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/company-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save company context");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3 max-w-xl mb-12">
      <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono flex items-center gap-2">
        <FileText className="w-3.5 h-3.5" />
        Company context file
      </h2>
      <p className="text-[13px] text-fg-2 leading-relaxed">
        The canonical brief every AI surface reads — digest triage, Ask, Scan, Capture, and
        Signals all frame their output against this file. It holds the impact rubric,
        priority topics, exclusions, and relevance feedback. Markdown,{" "}
        <code className="font-mono text-[12px]">data/company-context.md</code>.
      </p>

      {saved && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl text-[13px] font-medium"
          style={{ background: "var(--green-bg)", color: "var(--green)" }}
        >
          <CheckCircle className="w-4 h-4" /> Company context saved
        </div>
      )}
      {error && (
        <div
          className="p-3 rounded-xl text-[13px] font-medium"
          style={{ background: "var(--red-bg)", color: "var(--red)" }}
        >
          {error}
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={18}
        disabled={loading}
        placeholder={loading ? "Loading…" : "# Company context in markdown…"}
        className="field resize-y font-mono text-[12px] leading-relaxed"
        spellCheck={false}
      />

      <button
        type="submit"
        disabled={saving || loading || !content.trim()}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent hover:bg-accent-2 text-white font-mono text-[11px] tracking-[0.04em] uppercase font-medium rounded-xl transition-all duration-150 hover:shadow-[var(--shadow-m)] disabled:opacity-50"
      >
        <Save className="w-3.5 h-3.5" />
        {saving ? "Saving..." : "Save Company Context"}
      </button>
    </form>
  );
}
