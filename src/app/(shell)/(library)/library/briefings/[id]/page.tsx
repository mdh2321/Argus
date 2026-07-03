"use client";

import { use } from "react";
import { BriefingDetail } from "@/components/library/briefing-detail";

export default function BriefingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BriefingDetail id={id} />;
}
