"use client";

import { usePathname } from "next/navigation";

export function ShellMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const trackerLibrary = pathname === "/tracker";
  const dashboard = pathname === "/";
  // The reworked entry page carries a rail beside the reading column and a
  // full-width instrument reader, so it needs more room than the 5xl reading
  // shell — but less than the library's table.
  const entryV2 = /^\/tracker\/[^/]+(?:\/v2)?$/.test(pathname);

  return (
    <main
      id="main-content"
      className={`workspace-main px-8 py-10 xl:px-12 xl:py-12 ${
        trackerLibrary ? "workspace-wide" : entryV2 ? "workspace-wide" : dashboard ? "workspace-wide" : "workspace-reading"
      }`}
    >
      {children}
    </main>
  );
}
