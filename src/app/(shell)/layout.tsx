import { TopNav } from "@/components/layout/top-nav";
import { GlobalSearch } from "@/components/shared/global-search";
import { CaptureModal } from "@/components/shared/capture-modal";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TopNav />
      <GlobalSearch />
      <CaptureModal />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </>
  );
}
