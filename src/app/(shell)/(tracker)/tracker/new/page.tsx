"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileUp,
  Link2,
  LoaderCircle,
  Sparkles,
  MessageSquareText,
} from "lucide-react";

type Mode = "describe" | "url" | "upload";

export default function NewEntryPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("describe");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [fileHint, setFileHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(file: File | null) {
    setError(null);
    setFileHint(null);
    if (!file) {
      setDocumentName("");
      setDocumentText("");
      return;
    }
    setDocumentName(file.name);
    const lowerName = file.name.toLowerCase();
    const textLike =
      file.type.startsWith("text/") ||
      [".txt", ".md", ".html", ".htm", ".json", ".xml", ".csv"].some((ext) =>
        lowerName.endsWith(ext)
      );
    if (textLike) {
      const text = await file.text();
      setDocumentText(text.slice(0, 60000));
      setFileHint(`Loaded ${file.name} (${text.length.toLocaleString()} chars).`);
    } else {
      setDocumentText("");
      setFileHint(
        `${file.name} format is not directly readable. Paste or upload a text/HTML/Markdown version for best results.`
      );
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let payload: Record<string, unknown>;
    if (mode === "describe") {
      const trimmed = description.trim();
      if (!trimmed) {
        setError("Describe the regulation so Sentinel can search for it.");
        return;
      }
      payload = { mode: "describe", description: trimmed };
    } else if (mode === "url") {
      const trimmed = url.trim();
      if (!trimmed) {
        setError("Paste a source URL.");
        return;
      }
      payload = { mode: "url", url: trimmed };
    } else {
      if (!documentName.trim() || !documentText.trim()) {
        setError("Upload a text-readable document (.txt, .md, .html, .csv, .json).");
        return;
      }
      payload = { mode: "document", name: documentName, text: documentText };
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tracker/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Capture failed" }));
        throw new Error(data.error || "Capture failed");
      }
      const data = (await res.json()) as { entry?: { id: string } };
      if (!data.entry?.id) throw new Error("No entry returned");
      router.push(`/tracker/${data.entry.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  const loadingMessage =
    mode === "describe"
      ? "Searching for the regulation..."
      : mode === "url"
        ? "Reading the source..."
        : "Extracting from the document...";

  return (
    <div className="max-w-3xl anim-enter">
      <Link
        href="/tracker"
        className="mb-8 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:text-fg-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Tracker
      </Link>

      <div className="relative mb-8 grid-pattern py-4">
        <div className="relative z-10 flex items-center gap-2.5">
          <Sparkles className="h-5 w-5" style={{ color: "var(--accent)" }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">
            New Entry
          </h1>
        </div>
        <p className="relative z-10 mt-1.5 max-w-2xl text-[14px] text-fg-3">
          Describe a regulation, paste a URL, or upload a document. Sentinel extracts the
          structured entry — you review and refine on the next screen.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-border bg-surface p-1">
        <ModeTab
          active={mode === "describe"}
          onClick={() => setMode("describe")}
          icon={<MessageSquareText className="h-3.5 w-3.5" />}
          label="Describe"
        />
        <ModeTab
          active={mode === "url"}
          onClick={() => setMode("url")}
          icon={<Link2 className="h-3.5 w-3.5" />}
          label="URL"
        />
        <ModeTab
          active={mode === "upload"}
          onClick={() => setMode("upload")}
          icon={<FileUp className="h-3.5 w-3.5" />}
          label="Upload"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]"
      >
        {mode === "describe" && (
          <Field
            label="Describe the regulation"
            hint="Plain English works — e.g. &quot;Singapore's new AI governance framework from IMDA&quot; or &quot;the Australian privacy reform that introduces a direct right of action&quot;. Sentinel searches primary sources."
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="What regulation would you like Sentinel to find and track?"
              className="field resize-y"
              autoFocus
            />
          </Field>
        )}

        {mode === "url" && (
          <Field
            label="Source URL"
            hint="Paste legislation, regulator guidance, consultation, or enforcement links. Sentinel fetches and extracts."
          >
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="field pl-10"
                autoFocus
              />
            </div>
          </Field>
        )}

        {mode === "upload" && (
          <>
            <Field
              label="Upload document"
              hint="Text-readable files (.txt, .md, .html, .csv, .json) are extracted fully. Other formats need a text conversion first."
            >
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-6 text-[13px] text-fg-2 transition-colors hover:border-border-hover hover:bg-hover">
                <FileUp className="h-4 w-4" />
                <span>{documentName || "Choose a document"}</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => void handleFileChange(e.target.files?.[0] || null)}
                />
              </label>
              {fileHint && <p className="mt-2 text-[12px] text-fg-3">{fileHint}</p>}
            </Field>

            {documentText && (
              <Field
                label="Extracted text (editable)"
                hint="Trim or edit before sending to Sentinel. Up to ~50k characters are used."
              >
                <textarea
                  value={documentText}
                  onChange={(e) => setDocumentText(e.target.value)}
                  rows={10}
                  className="field resize-y font-mono text-[12px]"
                />
              </Field>
            )}
          </>
        )}

        {error && (
          <div className="rounded-xl border border-red/20 bg-red-bg px-4 py-3 text-[13px] text-red">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-white transition-all hover:-translate-y-px hover:bg-accent-2 hover:shadow-[var(--shadow-m)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {loadingMessage}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Capture with Sentinel
              </>
            )}
          </button>
          {loading && (
            <span className="text-[12px] text-fg-3">
              This usually takes 10–30 seconds.
            </span>
          )}
        </div>
      </form>

      <style jsx>{`
        .field {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid var(--border);
          background: var(--bg);
          padding: 0.75rem 0.875rem;
          font-size: 0.875rem;
          color: var(--fg);
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .field:focus {
          border-color: var(--border-accent);
          box-shadow: var(--shadow-m);
        }
      `}</style>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] transition-all ${
        active
          ? "bg-accent text-white shadow-[var(--shadow-m)]"
          : "text-fg-3 hover:bg-hover hover:text-fg-2"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label-mono mb-1.5 block">{label}</label>
      {hint && <p className="mb-2 text-[12px] text-fg-3">{hint}</p>}
      {children}
    </div>
  );
}
