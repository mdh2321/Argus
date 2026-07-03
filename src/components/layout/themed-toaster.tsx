"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/layout/theme-provider";

export function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      duration={6000}
    />
  );
}
