import type { Metadata } from "next";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ThemedToaster } from "@/components/layout/themed-toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "Argus — APJ Legal Intelligence",
  description: "Legal intelligence platform tracking Asia-Pacific regulations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
    >
      <body className="min-h-screen bg-bg text-fg">
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
