"use client";

import { usePathname } from "next/navigation";

export function ShellMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const trackerLibrary = pathname === "/tracker";

  return (
    <main
      id="main-content"
      className={`mx-auto w-full px-4 py-7 sm:px-6 sm:py-8 ${
        trackerLibrary ? "max-w-[1440px]" : "max-w-5xl"
      }`}
    >
      {children}
    </main>
  );
}
