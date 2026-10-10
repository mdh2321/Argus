"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

export function SidePanel({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode }) {
  const descriptionId = useId();
  const opener = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="argus-veil" />
      <Dialog.Content className="argus-panel" aria-describedby={description ? descriptionId : undefined} onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}>
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-border px-7 py-6">
          <div><Dialog.Title className="text-[21px] font-medium tracking-[-.025em]">{title}</Dialog.Title>{description && <Dialog.Description id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-fg-3">{description}</Dialog.Description>}</div>
          <Dialog.Close className="rounded-xl p-2 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close panel"><X size={19} /></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-7">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
