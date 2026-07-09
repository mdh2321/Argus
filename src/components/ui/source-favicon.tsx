"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The domain favicon beside a source name — the cheapest trust signal there is;
 * a reader recognises a regulator or a law firm by its mark before reading the
 * label. Falls back to a neutral globe when the domain has no favicon or the
 * request fails, so a broken icon never shows.
 */

function hostOf(input?: string | null): string | null {
  if (!input) return null;
  try {
    const url = input.includes("://") ? input : `https://${input}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function SourceFavicon({
  url,
  size = 16,
  className,
}: {
  /** A full URL or a bare domain. */
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const host = hostOf(url);
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (!host || failed) {
    return (
      <Globe
        aria-hidden="true"
        strokeWidth={1.5}
        className={cn("flex-shrink-0 text-fg-3", className)}
        style={box}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicons come from
    // arbitrary source domains; next/image would need every host allow-listed.
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("flex-shrink-0 rounded-[3px] object-contain", className)}
      style={box}
    />
  );
}
