"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  AskConversationalAnswer,
  AskScope,
  AskSentinelAnswer,
  AskSentinelCitation,
  AskSourceOption,
} from "@/lib/ask-types";
import { AgentBadge } from "@/components/ui/agent-badge";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { HistoryDrawer } from "@/components/ask/history-drawer";
import { askAnswerToMarkdown } from "@/lib/markdown-export";
import { toast } from "sonner";
import {
  ArrowRight,
  Bot,
  ExternalLink,
  LoaderCircle,
  FileText,
  Zap,
  ChevronRight,
  BookmarkPlus,
  Plus,
  Clock,
  CornerDownLeft,
  Sparkles,
  CalendarClock,
  Scale,
  Target,
  Crosshair,
  X,
  AtSign,
  Search,
  Newspaper,
  BookOpen,
  Radio,
} from "lucide-react";

type Mode = "quick" | "deep_report";
type TurnKind = "structured" | "conversational";

interface Starter {
  label: string;
  prompt: string;
  icon: typeof Sparkles;
  /** suggested mode for this kind of question */
  mode: Mode;
  iconClass: string;
  chipClass: string;
}

// Each starter nudges the user toward a distinct workflow / question shape.
const STARTERS: Starter[] = [
  {
    label: "What changed",
    prompt: "What changed this week in APAC privacy law?",
    icon: Sparkles,
    mode: "quick",
    iconClass: "text-accent",
    chipClass: "bg-accent-bg",
  },
  {
    label: "Deadlines",
    prompt: "Which tracked items have deadlines in the next 60 days?",
    icon: CalendarClock,
    mode: "quick",
    iconClass: "text-amber",
    chipClass: "bg-amber-bg",
  },
  {
    label: "Compare jurisdictions",
    prompt: "Compare Singapore and Japan on AI governance.",
    icon: Scale,
    mode: "deep_report",
    iconClass: "text-cyan",
    chipClass: "bg-cyan-bg",
  },
  {
    label: "Prioritize & plan",
    prompt: "What matters most for a SaaS legal team right now? Turn it into a checklist.",
    icon: Target,
    mode: "deep_report",
    iconClass: "text-purple",
    chipClass: "bg-purple-bg",
  },
];

const FALLBACK_FOLLOWUPS = STARTERS.map((s) => s.prompt);

// When the conversation is scoped to records, the starters become
// document-shaped questions rather than corpus-wide workflows.
const SCOPED_STARTERS = [
  "Summarize the key obligations and who they apply to.",
  "What are the deadlines or effective dates?",
  "What are the penalties for non-compliance?",
  "How does this affect a SaaS / e-signature business?",
];

// News scope is a quick, conversational chat — these read like text messages.
const NEWS_STARTERS = [
  "What's the gist?",
  "Why does this matter for us?",
  "Has there been any reaction or follow-up?",
  "How does this compare to other jurisdictions?",
];

const MODE_META: Record<Mode, { label: string; icon: typeof Zap; blurb: string }> = {
  quick: {
    label: "Quick",
    icon: Zap,
    blurb: "Fast answer with citations from tracked records.",
  },
  deep_report: {
    label: "Deep Report",
    icon: FileText,
    blurb: "Long-form brief with sections and grounded claims.",
  },
};

const KIND_META: Record<AskScope["kind"], { label: string; icon: typeof Newspaper }> = {
  entry: { label: "Tracker", icon: Crosshair },
  story: { label: "News", icon: Newspaper },
  knowledge: { label: "Knowledge", icon: BookOpen },
  signal: { label: "Signal", icon: Radio },
};

interface Turn {
  id: string;
  question: string;
  mode: Mode;
  kind: TurnKind;
  status: "loading" | "streaming" | "done" | "error";
  answer: AskSentinelAnswer | null;
  /** Conversational (news) answers stream prose here. */
  text: string;
  citations: AskSentinelCitation[];
  error?: string;
  progressTokens: number;
  answeredAt?: string;
}

/** One stored message returned by GET /api/ask/sessions/[id]. */
interface LoadedMessage {
  role: string;
  content: string;
  citedEntryIds: string[] | null;
  answer: unknown;
  createdAt: string;
}

/** Serialize a whole conversation to markdown for pinning to the Shelf. */
function conversationToMarkdown(turns: Turn[]): string {
  return turns
    .map((turn) => {
      const q = `## ${turn.question}`;
      const a =
        turn.kind === "structured" && turn.answer
          ? askAnswerToMarkdown(turn.answer)
          : turn.text;
      return `${q}\n\n${a}`;
    })
    .join("\n\n---\n\n");
}

async function fetchSources(q: string): Promise<AskSourceOption[]> {
  try {
    const res = await fetch(`/api/ask/sources?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.sources ?? []) as AskSourceOption[];
  } catch {
    return [];
  }
}

export default function AskPage() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("quick");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scopes, setScopes] = useState<AskScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pinningConversation, setPinningConversation] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // A question seeded from the URL (`?q=`), e.g. a scope-aware chip on an entry
  // page (F2). Fired once the scope has been applied.
  const [seededQuestion, setSeededQuestion] = useState<string | null>(null);

  // Seed the working set from `?scopeKind=&scopeId=&scopeLabel=` (and optionally
  // `?q=`) when arriving via an "Ask about this" entry point. Read from the URL
  // directly (client-only) to avoid a prerender Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("scopeKind");
    const id = params.get("scopeId");
    const label = params.get("scopeLabel");
    if ((kind === "entry" || kind === "story" || kind === "knowledge" || kind === "signal") && id) {
      setScopes([{ kind, id, label: label || undefined }]);
    }
    const q = params.get("q");
    if (q && q.trim()) setSeededQuestion(q.trim());
    const sessionParam = params.get("session");
    if (sessionParam) void loadSession(sessionParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire the seeded question once — after the scope from the same URL has been
  // applied, so the answer is grounded against the intended entry's corpus.
  useEffect(() => {
    if (seededQuestion && !busy && turns.length === 0) {
      const q = seededQuestion;
      setSeededQuestion(null);
      void submit(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededQuestion, scopes]);

  // News scope (story-only working set) is a conversational chat: no quick/deep
  // toggle, web-grounded answers, text-message tone.
  const isNews = scopes.length > 0 && scopes.every((s) => s.kind === "story");

  const hasConversation = turns.length > 0;

  const lastDone = [...turns].reverse().find((t) => t.status === "done")?.answer ?? null;
  const followUps = isNews
    ? NEWS_STARTERS
    : lastDone?.relatedQuestions?.length
      ? lastDone.relatedQuestions
      : FALLBACK_FOLLOWUPS.slice(0, 3);

  useEffect(() => {
    if (hasConversation) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns, hasConversation]);

  function patchTurn(id: string, patch: Partial<Turn>) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addScope(opt: AskSourceOption) {
    setScopes((prev) =>
      prev.some((s) => s.kind === opt.kind && s.id === opt.id)
        ? prev
        : [...prev, { kind: opt.kind, id: opt.id, label: opt.title }]
    );
  }

  function removeScope(index: number) {
    setScopes((prev) => prev.filter((_, i) => i !== index));
  }

  function scopeBody() {
    return scopes.length > 0 ? { scopes } : {};
  }

  // ── streaming: deep report (structured) ──
  async function streamStructured(id: string, question: string) {
    const res = await fetch("/api/ask/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question, sessionId, ...scopeBody() }),
    });
    if (!res.ok || !res.body) throw new Error("stream failed");

    await readSSE(res.body, (evt) => {
      if (evt.type === "progress") {
        patchTurn(id, { progressTokens: Math.round(evt.chars / 4) });
      } else if (evt.type === "done") {
        if (evt.answer.sessionId) setSessionId(evt.answer.sessionId);
        patchTurn(id, { status: "done", answer: evt.answer, answeredAt: new Date().toISOString() });
      } else if (evt.type === "error") {
        patchTurn(id, { status: "error", error: evt.message });
      }
    });
  }

  // ── streaming: conversational news Q&A ──
  async function streamConversational(id: string, question: string) {
    const res = await fetch("/api/ask/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question, sessionId, ...scopeBody() }),
    });
    if (!res.ok || !res.body) throw new Error("stream failed");

    let acc = "";
    await readSSE(res.body, (evt) => {
      if (evt.type === "delta") {
        acc += evt.text;
        patchTurn(id, { status: "streaming", text: acc });
      } else if (evt.type === "done") {
        if (evt.answer.sessionId) setSessionId(evt.answer.sessionId);
        patchTurn(id, {
          status: "done",
          text: evt.answer.content || acc,
          citations: evt.answer.citations || [],
          answeredAt: new Date().toISOString(),
        });
      } else if (evt.type === "error") {
        patchTurn(id, { status: "error", error: evt.message });
      }
    });
  }

  async function runQuick(id: string, question: string) {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question, sessionId, ...scopeBody() }),
    });
    if (!res.ok) throw new Error("ask failed");
    const data = (await res.json()) as AskSentinelAnswer;
    if (data.sessionId) setSessionId(data.sessionId);
    patchTurn(id, { status: "done", answer: data, answeredAt: new Date().toISOString() });
  }

  async function submit(raw: string, overrideMode?: Mode) {
    const question = raw.trim();
    if (!question || busy) return;

    const kind: TurnKind = isNews ? "conversational" : "structured";
    const turnMode = kind === "conversational" ? "quick" : overrideMode ?? mode;
    if (overrideMode && kind === "structured") setMode(overrideMode);

    const id = crypto.randomUUID();
    setInput("");
    setBusy(true);
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        mode: turnMode,
        kind,
        status: kind === "conversational" || turnMode === "deep_report" ? "streaming" : "loading",
        answer: null,
        text: "",
        citations: [],
        progressTokens: 0,
      },
    ]);

    try {
      if (kind === "conversational") await streamConversational(id, question);
      else if (turnMode === "deep_report") await streamStructured(id, question);
      else await runQuick(id, question);
    } catch {
      patchTurn(id, { status: "error", error: "Sentinel could not complete that request." });
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(input);
  }

  function newConversation() {
    if (busy) return;
    setTurns([]);
    setSessionId(null);
    setInput("");
  }

  // Rehydrate a past conversation from the History drawer. Assistant turns with
  // a stored `answer` re-render at full fidelity (structured card or news
  // bubble); older turns (answer === null) fall back to the saved summary text.
  async function loadSession(id: string) {
    if (busy) return;
    try {
      const res = await fetch(`/api/ask/sessions/${id}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { id: string; messages: LoadedMessage[] };

      const rebuilt: Turn[] = [];
      let question = "";
      for (const m of data.messages) {
        if (m.role === "user") {
          question = m.content;
          continue;
        }
        if (m.role !== "assistant") continue;
        const ans = m.answer as (AskSentinelAnswer & Partial<AskConversationalAnswer>) | null;
        const structured = !!ans && typeof ans.summary === "string" && "mode" in ans;
        if (ans && structured) {
          rebuilt.push({
            id: crypto.randomUUID(),
            question,
            mode: ans.mode ?? "quick",
            kind: "structured",
            status: "done",
            answer: ans as AskSentinelAnswer,
            text: "",
            citations: ans.citations ?? [],
            answeredAt: m.createdAt,
            progressTokens: 0,
          });
        } else {
          // Conversational answer, or an old turn with only summary text.
          rebuilt.push({
            id: crypto.randomUUID(),
            question,
            mode: "quick",
            kind: "conversational",
            status: "done",
            answer: null,
            text: ans?.content ?? m.content,
            citations: ans?.citations ?? [],
            answeredAt: m.createdAt,
            progressTokens: 0,
          });
        }
        question = "";
      }

      setScopes([]);
      setTurns(rebuilt);
      setSessionId(data.id);
      setInput("");
      setHistoryOpen(false);
    } catch {
      toast.error("Couldn't load that conversation");
    }
  }

  // Freeze the whole thread as one dated Shelf artifact. Reuses the existing
  // /api/library/pin endpoint (itemType 'pinned_answer').
  async function pinConversation() {
    if (turns.length === 0 || pinningConversation) return;
    setPinningConversation(true);
    try {
      const res = await fetch("/api/library/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: turns[0].question,
          content: conversationToMarkdown(turns),
        }),
      });
      if (!res.ok) throw new Error("pin failed");
      toast.success("Conversation pinned to the Shelf");
    } catch {
      toast.error("Couldn't pin this conversation");
    } finally {
      setPinningConversation(false);
    }
  }

  const composer = (
    <Composer
      large={!hasConversation}
      input={input}
      setInput={setInput}
      mode={mode}
      setMode={setMode}
      busy={busy}
      hideMode={isNews}
      onSubmit={handleSubmit}
      onEnter={() => void submit(input)}
      onAddScope={addScope}
      placeholder={
        isNews
          ? "Ask a follow-up about this story…"
          : hasConversation
            ? "Ask a follow-up…  (use @ to add a source)"
            : "Ask about a topic, deadline, or change — type @ to scope to specific sources…"
      }
    />
  );

  const scopeBar = scopes.length > 0 && (
    <SourceChips scopes={scopes} onRemove={removeScope} onAdd={addScope} disabled={busy} />
  );

  return (
    <div className="anim-enter">
      {!hasConversation ? (
        /* ===== Hero / empty state ===== */
        <div className="mx-auto flex min-h-[72vh] max-w-3xl flex-col items-center justify-center py-8">
          <div className="grid-pattern relative mb-8 w-full py-6 text-center">
            <div className="relative z-10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border-accent bg-accent-bg">
              <Bot className="h-6 w-6" style={{ color: "var(--accent)" }} />
            </div>
            <h1 className="text-gradient relative z-10 text-[34px] font-bold leading-tight tracking-[-0.02em]">
              Ask Sentinel
            </h1>
            <p className="relative z-10 mx-auto mt-2 max-w-xl text-[14px] leading-relaxed text-fg-3">
              {isNews
                ? "Chatting about a news story — quick, conversational answers grounded in the article, with live web search and checkable sources."
                : scopes.length > 0
                  ? "Scoped to your selected sources — answers draw on these records, with passage-level grounding."
                  : "Ask a legal-intelligence question and get a brief with linked citations across your tracked records. Pick a workflow below, add sources with @, or just start typing."}
            </p>
          </div>

          {scopeBar && <div className="mb-4 w-full">{scopeBar}</div>}

          <div className="w-full">{composer}</div>

          <button
            onClick={() => setHistoryOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:text-fg-2"
          >
            <Clock className="h-3.5 w-3.5" />
            View past conversations
          </button>

          {scopes.length > 0 ? (
            /* Document-shaped starters when scoped */
            <div className="mt-6 flex w-full flex-wrap gap-2">
              {(isNews ? NEWS_STARTERS : SCOPED_STARTERS).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => void submit(prompt)}
                  disabled={busy}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:border-border-hover hover:bg-hover hover:text-fg disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : (
            /* Smart starters — each nudges a different workflow */
            <div className="mt-6 grid w-full gap-2.5 sm:grid-cols-2">
              {STARTERS.map((starter) => (
                <StarterCard
                  key={starter.label}
                  starter={starter}
                  disabled={busy}
                  onClick={() => void submit(starter.prompt, starter.mode)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ===== Conversation ===== */
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex items-center gap-2.5">
            <Bot className="h-5 w-5" style={{ color: "var(--accent)" }} />
            <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">Ask Sentinel</h1>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => void pinConversation()}
                disabled={busy || pinningConversation}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2 disabled:opacity-50"
                title="Pin this whole conversation to the Shelf"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                {pinningConversation ? "Pinning…" : "Pin"}
              </button>
              <button
                onClick={() => setHistoryOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
              >
                <Clock className="h-3.5 w-3.5" />
                History
              </button>
              <button
                onClick={newConversation}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          </div>

          {scopeBar && <div className="mb-4">{scopeBar}</div>}

          <div className="space-y-6">
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} onRelated={(q) => void submit(q)} />
            ))}
          </div>

          <div ref={bottomRef} />

          <div className="sticky bottom-4 mt-6">{composer}</div>

          {/* Suggested follow-ups when idle */}
          {!busy && (
            <div className="mt-3 flex flex-wrap gap-2 pb-2">
              {followUps.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => void submit(prompt)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:border-border-hover hover:bg-hover hover:text-fg"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => void loadSession(id)}
        activeId={sessionId}
      />
    </div>
  );
}

/** SSE events emitted by /api/ask/stream (deep report + conversational). */
type StreamEvent =
  | { type: "progress"; chars: number }
  | { type: "delta"; text: string }
  | { type: "done"; answer: AskSentinelAnswer & Partial<AskConversationalAnswer> }
  | { type: "error"; message: string };

/** Read an SSE response body, invoking `onEvent` for each parsed `data:` event. */
async function readSSE(body: ReadableStream<Uint8Array>, onEvent: (evt: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
    }
  }
}

function SourceChips({
  scopes,
  onRemove,
  onAdd,
  disabled,
}: {
  scopes: AskScope[];
  onRemove: (index: number) => void;
  onAdd: (opt: AskSourceOption) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-accent bg-accent-bg/40 px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-accent">Sources</span>
      {scopes.map((scope, i) => {
        const Meta = KIND_META[scope.kind];
        const Icon = Meta.icon;
        return (
          <span
            key={`${scope.kind}:${scope.id}`}
            className="inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-fg-2"
          >
            <Icon className="h-3 w-3 flex-shrink-0 text-fg-3" />
            <span className="truncate">{scope.label || scope.id}</span>
            <button
              onClick={() => onRemove(i)}
              disabled={disabled}
              title="Remove source"
              className="flex-shrink-0 rounded text-fg-3 transition-colors hover:text-fg disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <AddSourcesButton onAdd={onAdd} disabled={disabled} />
    </div>
  );
}

/** Popover button that opens a searchable source picker. */
function AddSourcesButton({
  onAdd,
  disabled,
}: {
  onAdd: (opt: AskSourceOption) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2 disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
        Add sources
      </button>
      {open && (
        <SourceSearchPanel
          onPick={(opt) => {
            onAdd(opt);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Shared searchable source list, used by the picker popover. */
function SourceSearchPanel({
  onPick,
  onClose,
}: {
  onPick: (opt: AskSourceOption) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AskSourceOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      if (active) setLoading(true);
      const r = await fetchSources(q);
      if (active) {
        setResults(r);
        setLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="absolute left-0 top-full z-20 mt-1.5 w-[340px] rounded-xl border border-border bg-surface p-2 shadow-[var(--shadow-l)]">
      <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-fg-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Search entries, news, knowledge, signals…"
          className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
      </div>
      <SourceResultList results={results} loading={loading} onPick={onPick} />
    </div>
  );
}

function SourceResultList({
  results,
  loading,
  onPick,
}: {
  results: AskSourceOption[];
  loading: boolean;
  onPick: (opt: AskSourceOption) => void;
}) {
  if (loading && results.length === 0) {
    return <div className="px-2 py-3 text-[12px] text-fg-3">Searching…</div>;
  }
  if (results.length === 0) {
    return <div className="px-2 py-3 text-[12px] text-fg-3">No matching sources.</div>;
  }
  return (
    <div className="max-h-[280px] overflow-y-auto">
      {results.map((opt) => {
        const Icon = KIND_META[opt.kind].icon;
        return (
          <button
            key={`${opt.kind}:${opt.id}`}
            onClick={() => onPick(opt)}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-fg-3" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-fg">{opt.title}</span>
              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.03em] text-fg-3">
                {opt.meta}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Composer({
  large,
  input,
  setInput,
  mode,
  setMode,
  busy,
  hideMode,
  onSubmit,
  onEnter,
  onAddScope,
  placeholder,
}: {
  large: boolean;
  input: string;
  setInput: (v: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  busy: boolean;
  hideMode: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onEnter: () => void;
  onAddScope: (opt: AskSourceOption) => void;
  placeholder: string;
}) {
  // Active @-mention: a trailing "@token" (optionally after whitespace).
  const mentionMatch = input.match(/(^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[2] : null;
  const [mentionResults, setMentionResults] = useState<AskSourceOption[]>([]);

  useEffect(() => {
    // No active mention → nothing to fetch. The dropdown is gated on
    // `mentionQuery !== null` at render, so stale results never show.
    if (mentionQuery === null) return;
    let active = true;
    const t = setTimeout(async () => {
      const r = await fetchSources(mentionQuery);
      if (active) setMentionResults(r);
    }, 150);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [mentionQuery]);

  function pickMention(opt: AskSourceOption) {
    onAddScope(opt);
    // Strip the trailing "@token" the user was typing.
    setInput(input.replace(/(^|\s)@([^\s@]*)$/, "$1"));
    setMentionResults([]);
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`relative rounded-2xl border border-border bg-surface transition-shadow focus-within:border-border-accent focus-within:shadow-[var(--shadow-l)] ${
        large ? "p-4 shadow-[var(--shadow-card)]" : "p-3.5 shadow-[var(--shadow-m)]"
      }`}
    >
      {mentionQuery !== null && mentionResults.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-[420px] rounded-xl border border-border bg-surface p-2 shadow-[var(--shadow-l)]">
          <div className="mb-1 flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
            <AtSign className="h-3 w-3" />
            Add a source
          </div>
          <SourceResultList results={mentionResults} loading={false} onPick={pickMention} />
        </div>
      )}

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            // Don't submit while choosing a mention — let the dropdown win.
            if (mentionQuery !== null && mentionResults.length > 0) return;
            e.preventDefault();
            onEnter();
          }
        }}
        rows={large ? 3 : 2}
        placeholder={placeholder}
        className={`w-full resize-none bg-transparent px-1.5 text-fg outline-none placeholder:text-fg-3 ${
          large ? "text-[16px] leading-relaxed" : "text-[14px]"
        }`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!hideMode && (
            <div className="flex items-center gap-1 overflow-hidden rounded-xl border border-border">
              {(Object.keys(MODE_META) as Mode[]).map((m) => {
                const Icon = MODE_META[m].icon;
                return (
                  <ModeButton
                    key={m}
                    active={mode === m}
                    onClick={() => setMode(m)}
                    icon={<Icon className="h-3 w-3" />}
                    label={MODE_META[m].label}
                  />
                );
              })}
            </div>
          )}
          {large && !hideMode && (
            <span className="hidden text-[12px] text-fg-3 sm:inline">{MODE_META[mode].blurb}</span>
          )}
          {hideMode && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-accent">
              <Newspaper className="h-3 w-3" />
              News chat · web-grounded
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-white transition-all hover:-translate-y-px hover:bg-accent-2 hover:shadow-[var(--shadow-m)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {busy ? (
            <>
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Thinking
            </>
          ) : (
            <>
              Ask Sentinel
              <CornerDownLeft className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function StarterCard({
  starter,
  disabled,
  onClick,
}: {
  starter: Starter;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = starter.icon;
  const ModeIcon = MODE_META[starter.mode].icon;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-start gap-3 rounded-2xl border border-border bg-surface p-3.5 text-left shadow-[var(--shadow-s)] transition-all hover:-translate-y-px hover:border-border-hover hover:shadow-[var(--shadow-m)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
    >
      <span
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${starter.chipClass}`}
      >
        <Icon className={`h-4.5 w-4.5 ${starter.iconClass}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-fg">{starter.label}</span>
          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.04em] text-fg-3">
            <ModeIcon className="h-2.5 w-2.5" />
            {MODE_META[starter.mode].label}
          </span>
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-fg-2 transition-colors group-hover:text-fg">
          {starter.prompt}
        </span>
      </span>
      <ArrowRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors ${
        active ? "bg-accent text-white" : "text-fg-3 hover:bg-hover hover:text-fg-2"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TurnView({ turn, onRelated }: { turn: Turn; onRelated: (q: string) => void }) {
  return (
    <div className="space-y-3">
      {/* Question */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-border bg-hover px-4 py-2.5 text-[14px] text-fg">
          {turn.question}
        </div>
      </div>

      {/* Answer / status */}
      {turn.kind === "conversational" ? (
        <ConversationalAnswer turn={turn} />
      ) : turn.status === "done" && turn.answer ? (
        <AnswerCard answer={turn.answer} answeredAt={turn.answeredAt ?? null} onRelated={onRelated} />
      ) : turn.status === "error" ? (
        <div className="rounded-xl border border-red/20 bg-red-bg px-4 py-3 text-[13px] text-red">
          {turn.error || "Something went wrong."}
        </div>
      ) : (
        <PendingCard mode={turn.mode} progressTokens={turn.progressTokens} />
      )}
    </div>
  );
}

/** Text-message-style answer bubble for news-story chat, with checkable sources. */
function ConversationalAnswer({ turn }: { turn: Turn }) {
  if (turn.status === "error") {
    return (
      <div className="rounded-xl border border-red/20 bg-red-bg px-4 py-3 text-[13px] text-red">
        {turn.error || "Something went wrong."}
      </div>
    );
  }

  const streaming = turn.status !== "done";
  const paras = turn.text.split(/\n{2,}/).filter(Boolean);

  return (
    <div className="space-y-2.5">
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 shadow-[var(--shadow-s)]">
        {turn.text ? (
          <div className="space-y-2 text-[14px] leading-relaxed text-fg-2">
            {paras.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-fg-3">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
            Reading the story and searching…
          </div>
        )}
        {streaming && turn.text && (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />
        )}
      </div>

      {turn.status === "done" && turn.citations.length > 0 && (
        <div className="max-w-[85%]">
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
            <ExternalLink className="h-3 w-3" />
            Sources
          </div>
          <div className="flex flex-col gap-1.5">
            {turn.citations.map((c, i) => (
              <SourceRow key={`${c.id}-${i}`} index={i + 1} citation={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceRow({ index, citation }: { index: number; citation: AskSentinelCitation }) {
  const external = citation.externalUrl;
  const inner = (
    <>
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-hover font-mono text-[9px] text-fg-3">
        {index}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] text-fg-2 group-hover:text-fg">{citation.title}</span>
        <span className="block truncate font-mono text-[10px] text-fg-3">
          {citation.kind === "web" ? citation.sourceLabel : `${citation.kind} · ${citation.sourceLabel}`}
        </span>
      </span>
      <ExternalLink className="ml-auto h-3 w-3 flex-shrink-0 text-fg-3" />
    </>
  );

  const className =
    "group flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 transition-colors hover:border-border-hover hover:bg-hover";

  return external ? (
    <a href={external} target="_blank" rel="noopener noreferrer" className={className}>
      {inner}
    </a>
  ) : (
    <Link href={citation.href} className={className}>
      {inner}
    </Link>
  );
}

function PendingCard({ mode, progressTokens }: { mode: Mode; progressTokens: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5 text-[13px] text-fg-2">
        <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
        {mode === "deep_report" ? (
          <span>
            Composing report
            <span className="ml-2 font-mono text-[11px] text-fg-3">
              {elapsed}s · ~{progressTokens.toLocaleString()} tokens
            </span>
          </span>
        ) : (
          <span>
            Searching records and drafting
            <span className="ml-2 font-mono text-[11px] text-fg-3">{elapsed}s</span>
          </span>
        )}
      </div>
    </div>
  );
}

function AnswerCard({
  answer,
  answeredAt,
  onRelated,
}: {
  answer: AskSentinelAnswer;
  answeredAt: string | null;
  onRelated: (q: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function pinToShelf() {
    setSaving(true);
    try {
      const res = await fetch("/api/library/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: answer.query, content: askAnswerToMarkdown(answer) }),
      });
      if (!res.ok) throw new Error("pin failed");
      toast.success("Pinned to the Shelf");
    } catch {
      toast.error("Couldn't pin this answer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {answer.mode === "deep_report" && (
            <span className="rounded-full border border-purple/20 bg-purple-bg px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-purple">
              Deep Report
            </span>
          )}
          <span className="rounded-full bg-hover px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
            {answer.answerMode}
          </span>
          <span className="rounded-full bg-accent-bg px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-accent">
            {answer.confidence} confidence
          </span>
          <span className="rounded-full bg-hover px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
            {answer.matchedCount} matched records
          </span>
          {answer.groundingMetrics && (
            <span className="rounded-full border border-green/20 bg-green-bg px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-green">
              {Math.round(answer.groundingMetrics.groundingRatio * 100)}% grounded
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <CopyMarkdownButton getMarkdown={() => askAnswerToMarkdown(answer)} />
            <AgentBadge workflow="ask" timestamp={answeredAt} />
          </div>
        </div>

        <Section title="Executive summary">
          <p className="text-[15px] leading-relaxed text-fg-2">{answer.summary}</p>
        </Section>

        {answer.whyItMatters && (
          <Section title="Why it matters">
            <p className="text-[15px] leading-relaxed text-fg-2">{answer.whyItMatters}</p>
          </Section>
        )}

        {answer.reportSections?.map((section, i) => <ReportSection key={i} section={section} />)}

        {answer.actions.length > 0 && (
          <Section title="Recommended next steps">
            <div className="space-y-2">
              {answer.actions.map((action) => (
                <div key={`${action.title}-${action.detail}`} className="rounded-xl border border-border bg-bg px-4 py-3">
                  <div className="text-[13px] font-medium text-fg">{action.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{action.detail}</p>
                  {action.href && (
                    <Link
                      href={action.href}
                      className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.04em] text-accent transition-colors hover:text-accent-2"
                    >
                      Open record <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        <div className="mt-6 flex items-center gap-3 border-t border-border pt-4">
          <button
            onClick={() => void pinToShelf()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent/10 px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            {saving ? "Pinning…" : "Pin to Shelf"}
          </button>
        </div>
      </div>

      {answer.citations.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          <Section title="Citations">
            <div className="space-y-2">
              {answer.citations.map((citation) => (
                <div key={citation.id} className="rounded-xl border border-border px-4 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-hover px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3">
                      {citation.kind}
                    </span>
                    <span className="font-mono text-[11px] text-fg-3">{citation.meta}</span>
                  </div>
                  <div className="text-[14px] font-medium text-fg">{citation.title}</div>
                  <div className="mt-1 text-[12px] text-fg-3">{citation.sourceLabel}</div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <Link
                      href={citation.href}
                      className="inline-flex items-center gap-1 text-[12px] text-accent transition-colors hover:text-accent-2"
                    >
                      Open in Sentinel <ArrowRight className="h-3 w-3" />
                    </Link>
                    {citation.externalUrl && (
                      <a
                        href={citation.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-fg-3 transition-colors hover:text-fg-2"
                      >
                        Source link <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {answer.relatedQuestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {answer.relatedQuestions.map((q) => (
            <button
              key={q}
              onClick={() => onRelated(q)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:border-border-hover hover:bg-hover hover:text-fg"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="label-mono mb-2">{title}</h2>
      {children}
    </section>
  );
}

function ReportSection({ section }: { section: NonNullable<AskSentinelAnswer["reportSections"]>[number] }) {
  const [expanded, setExpanded] = useState(true);

  const groundingColors: Record<string, string> = {
    direct_quote: "var(--green)",
    paraphrase: "var(--cyan)",
    inference: "var(--amber)",
    ai_knowledge: "var(--red)",
  };

  return (
    <section className="mb-6 last:mb-0">
      <button type="button" onClick={() => setExpanded(!expanded)} className="group flex w-full items-center gap-2">
        <ChevronRight className={`h-3 w-3 text-fg-3 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
        <h2 className="label-mono">{section.heading}</h2>
      </button>
      {expanded && (
        <div className="mt-2 space-y-3 pl-5">
          {section.content
            .split("\n\n")
            .filter(Boolean)
            .map((para, i) => (
              <p key={i} className="text-[15px] leading-relaxed text-fg-2">
                {para}
              </p>
            ))}
          {section.claims?.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {section.claims.map((claim, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-border/60 bg-bg px-3 py-2">
                  <span
                    className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: groundingColors[claim.groundingType] || "var(--fg-3)" }}
                  />
                  <div className="min-w-0">
                    <span className="text-[13px] text-fg-2">{claim.text}</span>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span
                        className="font-mono text-[9px] uppercase tracking-[0.04em]"
                        style={{ color: groundingColors[claim.groundingType] || "var(--fg-3)" }}
                      >
                        {claim.groundingType.replace("_", " ")}
                      </span>
                      <span className="font-mono text-[9px] text-fg-3">{claim.confidence}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
