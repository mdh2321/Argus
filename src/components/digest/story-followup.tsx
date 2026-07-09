"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { readSSE } from "@/lib/ask-sse";
import { SourceFavicon } from "@/components/ui/source-favicon";
import type { AskArgusCitation } from "@/lib/ask-types";
import {
  MessagesSquare,
  CornerDownLeft,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";

// The story-scoped composer that lives at the foot of an expanded digest story.
// Reading and asking become one act: a question streams a web-grounded answer
// inline (the same conversational Ask path a story scope already triggers), so
// the reader never navigates away mid-digest. "Continue in Ask" hands the whole
// session off — context intact — only once the exchange gets deep.

const STORY_FOLLOWUPS = [
  "What's the gist?",
  "Why does this matter for us?",
  "Any reaction or follow-up?",
  "How does this compare to other jurisdictions?",
];

interface QA {
  id: string;
  question: string;
  text: string;
  citations: AskArgusCitation[];
  status: "streaming" | "done" | "error";
  error?: string;
}

export function StoryFollowup({
  storyId,
  storyTitle,
}: {
  storyId: string;
  storyTitle: string;
}) {
  const [input, setInput] = useState("");
  const [qas, setQas] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string | null>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");
    const id = crypto.randomUUID();
    setQas((prev) => [
      ...prev,
      { id, question: q, text: "", citations: [], status: "streaming" },
    ]);
    const patch = (u: Partial<QA>) =>
      setQas((prev) => prev.map((x) => (x.id === id ? { ...x, ...u } : x)));

    try {
      const res = await fetch("/api/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          sessionId: sessionRef.current,
          scopes: [{ kind: "story", id: storyId, label: storyTitle }],
        }),
      });
      if (!res.ok || !res.body) throw new Error("stream failed");
      let acc = "";
      await readSSE(res.body, (evt) => {
        if (evt.type === "delta") {
          acc += evt.text;
          patch({ text: acc });
        } else if (evt.type === "done") {
          if (evt.answer.sessionId) sessionRef.current = evt.answer.sessionId;
          patch({
            status: "done",
            text: evt.answer.content || acc,
            citations: evt.answer.citations || [],
          });
        } else if (evt.type === "error") {
          patch({ status: "error", error: evt.message });
        }
      });
    } catch {
      patch({ status: "error", error: "Couldn't reach the model — try again." });
    } finally {
      setBusy(false);
    }
  }

  // Hand off to the full Ask surface, carrying the live session so the thread
  // continues with its context rather than restarting.
  const askHref =
    `/ask?scopeKind=story&scopeId=${encodeURIComponent(storyId)}` +
    `&scopeLabel=${encodeURIComponent(storyTitle)}` +
    (sessionRef.current ? `&session=${encodeURIComponent(sessionRef.current)}` : "");

  return (
    <div
      className="mt-4 rounded-xl bg-bg p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="label-mono mb-2.5 flex items-center gap-1.5">
        <MessagesSquare className="h-3.5 w-3.5 text-accent" />
        Ask about this story
      </div>

      {qas.length > 0 && (
        <div className="mb-3 space-y-3">
          {qas.map((qa) => (
            <div key={qa.id} className="space-y-1.5">
              <div className="text-[13px] font-medium text-fg">{qa.question}</div>
              {qa.status === "error" ? (
                <div className="text-[13px] text-red">{qa.error}</div>
              ) : (
                <div className="text-[13.5px] leading-relaxed text-fg-2">
                  {qa.text ? (
                    qa.text
                      .split(/\n{2,}/)
                      .filter(Boolean)
                      .map((p, i) => (
                        <p key={i} className="mb-1.5 last:mb-0">
                          {p}
                        </p>
                      ))
                  ) : (
                    <span className="inline-flex items-center gap-2 text-fg-3">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
                      Reading the story and searching…
                    </span>
                  )}
                  {qa.status === "streaming" && qa.text && (
                    <span className="stream-cursor" aria-hidden="true" />
                  )}
                </div>
              )}
              {qa.status === "done" && qa.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {qa.citations.map((c, i) => (
                    <a
                      key={`${c.id}-${i}`}
                      href={c.externalUrl || c.href}
                      target={c.externalUrl ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
                    >
                      <SourceFavicon url={c.externalUrl || undefined} size={13} />
                      <span className="max-w-[180px] truncate">
                        {c.sourceLabel || c.title}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pre-drafted follow-ups — only before the first question, to avoid a
          blank-composer stare. Each is one tap into the stream. */}
      {qas.length === 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {STORY_FOLLOWUPS.map((f) => (
            <button
              key={f}
              onClick={() => void ask(f)}
              disabled={busy}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-fg-2 transition-colors hover:border-border-hover hover:bg-hover hover:text-fg disabled:opacity-50"
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 transition-colors focus-within:border-accent"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a follow-up…"
          disabled={busy}
          aria-label="Ask a follow-up about this story"
          className="flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-3"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send follow-up"
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <CornerDownLeft className="h-3 w-3" />
          )}
        </button>
      </form>

      {qas.length > 0 && (
        <Link
          href={askHref}
          className="mt-2.5 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.04em] text-accent-text transition-colors hover:text-accent"
        >
          Continue in Ask <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
