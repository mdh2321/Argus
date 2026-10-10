import { TopNav } from "@/components/layout/top-nav";
import { GlobalSearch } from "@/components/shared/global-search";
import { CaptureModal } from "@/components/shared/capture-modal";
import { ShellMain } from "@/components/layout/shell-main";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[100] inline-flex min-h-11 -translate-y-20 items-center rounded-lg bg-fg px-4 text-[14px] font-medium text-bg shadow-lg transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      <TopNav />
      <GlobalSearch />
      <CaptureModal />
      <ShellMain>{children}</ShellMain>
    </>
  );
}
