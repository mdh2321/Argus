"use client";

import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { Database } from "lucide-react";
import type { DigestStoryReference } from "@/hooks/use-digest";

interface Props {
  reference: DigestStoryReference;
  trigger: ReactNode;
}

export function UnmatchedReferencePopover({ reference, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleAdd() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/tracker/entries/from-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceId: reference.id }),
      });
      const json = (await res.json()) as { ok?: boolean; entryId?: string; error?: string };
      if (!res.ok || !json.entryId) {
        throw new Error(json.error || "Failed to add to tracker");
      }

      // Invalidate digest caches so the reference flips to matched on re-fetch.
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/api/digest/"),
        undefined,
        { revalidate: true }
      );

      const entryId = json.entryId;
      toast.success("Added to tracker", {
        description: "Argus is finding and verifying official sources.",
        action: {
          label: "View",
          onClick: () => router.push(`/tracker/${entryId}`),
        },
      });
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const proposedTypeLabel = reference.proposedType
    ? reference.proposedType.replace(/-/g, " ")
    : "—";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[320px] rounded-xl border border-border bg-surface p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-fg-3">
            <Database className="h-3 w-3" />
            Add to tracker
          </div>
          <div className="mb-3 text-[14px] font-semibold text-fg">
            {reference.proposedShortName || reference.text}
          </div>
          <dl className="mb-4 grid grid-cols-[80px_1fr] gap-y-1 font-mono text-[11px]">
            <dt className="text-fg-3">Jurisdiction</dt>
            <dd className="text-fg-2">{reference.proposedJurisdiction || "—"}</dd>
            <dt className="text-fg-3">Type</dt>
            <dd className="text-fg-2 capitalize">{proposedTypeLabel}</dd>
            <dt className="text-fg-3">Category</dt>
            <dd className="text-fg-2">{reference.proposedCategory || "—"}</dd>
            <dt className="text-fg-3">Regulator</dt>
            <dd className="text-fg-2">{reference.proposedRegulator || "—"}</dd>
          </dl>
          <p className="mb-4 text-[12px] leading-relaxed text-fg-3">
            Argus will draft a summary and impact framing from this story. You can edit
            everything on the tracker page after.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] text-fg-2 transition-colors hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={submitting}
              className="rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add to tracker"}
            </button>
          </div>
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
