"use client";

import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";

// F2 — scope-aware question chips. One tap opens an Ask session pre-scoped to
// this entry with the question seeded and answered against its corpus. The
// daily-use shape of Ask: a cited answer in one tap.

const CHIPS = [
  "What are the penalties?",
  "Does this apply to us directly or via customers?",
  "What are the key compliance deadlines?",
  "Who does this apply to?",
  "What are the exemptions?",
];

export function EntryQuestionChips({
  entryId,
  entryName,
}: {
  entryId: string;
  entryName: string;
}) {
  const router = useRouter();

  function ask(question: string) {
    const params = new URLSearchParams({
      scopeKind: "entry",
      scopeId: entryId,
      scopeLabel: entryName,
      q: question,
    });
    router.push(`/ask?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3">
        <MessagesSquare className="h-3.5 w-3.5" />
        Ask
      </span>
      {CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => ask(chip)}
          className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-fg-2 transition-colors hover:border-accent hover:text-fg"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
