"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, X, Link2, FileText } from "lucide-react";

// D2 — global capture. A paste-anywhere modal: drop a URL or raw text and
// Sentinel drafts a tracker entry (with a preliminary analysis kicked off by
// the capture route). Reachable from the command palette (D1) and the header.
// Decoupled open trigger via a window event so any surface can raise it.

const OPEN_CAPTURE_EVENT = "sentinel:open-capture";

export function openCaptureModal() {
  window.dispatchEvent(new CustomEvent(OPEN_CAPTURE_EVENT));
}

// A single http(s) token, nothing else → treat the input as a URL to fetch.
function looksLikeUrl(value: string): boolean {
  const t = value.trim();
  return /^https?:\/\/\S+$/i.test(t) && !/\s/.test(t);
}

export function CaptureModal() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onOpen() {
      setValue("");
      setOpen(true);
    }
    window.addEventListener(OPEN_CAPTURE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, onOpen);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting]);

  if (!open) return null;

  const trimmed = value.trim();
  const isUrl = looksLikeUrl(trimmed);
  const canSubmit = trimmed.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // A single URL → fetch-and-extract; anything else → describe-mode draft.
      const payload = isUrl
        ? { mode: "url", url: trimmed }
        : { mode: "describe", description: trimmed };
      const res = await fetch("/api/tracker/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Draft entry created — preliminary analysis in progress");
      setOpen(false);
      if (data.entry?.id) router.push(`/tracker/${data.entry.id}`);
    } catch (err) {
      toast.error("Capture failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110]">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !submitting && setOpen(false)}
      />
      <div className="fixed left-1/2 top-[16%] w-full max-w-lg -translate-x-1/2 px-4">
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-l)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-[13px] font-semibold text-fg">Capture to tracker</span>
            </div>
            <button
              onClick={() => !submitting && setOpen(false)}
              className="rounded-md p-1 text-fg-3 transition-colors hover:bg-hover hover:text-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4">
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={5}
              placeholder="Paste a URL to a law/regulation, or describe an instrument to track…"
              className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-fg-3 focus:border-accent"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-3">
                {isUrl ? (
                  <>
                    <Link2 className="h-3 w-3" /> URL — will fetch &amp; extract
                  </>
                ) : trimmed.length > 0 ? (
                  <>
                    <FileText className="h-3 w-3" /> Text — will draft from description
                  </>
                ) : (
                  <>Paste anything</>
                )}
              </span>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {submitting ? "Capturing…" : "Capture"}
                {!submitting && (
                  <kbd className="ml-1 rounded bg-black/20 px-1 py-0.5 text-[10px]">⌘↵</kbd>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
