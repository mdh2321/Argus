"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

interface CopyMarkdownButtonProps {
  /** Built lazily so the markdown reflects the latest data at click time. */
  getMarkdown: () => string;
  label?: string;
  className?: string;
}

export function CopyMarkdownButton({ getMarkdown, label = "Copy", className }: CopyMarkdownButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(getMarkdown());
      setCopied(true);
      toast.success("Copied as markdown — ready to paste into Slack or email");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  }

  return (
    <button
      onClick={copy}
      title="Copy as paste-ready markdown"
      className={
        className ||
        "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium font-mono rounded-lg text-fg-3 hover:text-fg-2 hover:bg-hover transition-colors"
      }
    >
      {copied ? <Check className="w-3 h-3 text-[var(--green)]" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}
