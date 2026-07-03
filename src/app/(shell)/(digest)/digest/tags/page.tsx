import { redirect } from "next/navigation";

// June 2026 refinement plan B4: the tags index is superseded by the
// platform-wide Topics wiki. Individual /digest/tags/[tag] pages remain for
// long-tail tag drill-downs (tag badges still link to them).
export default function DigestTagsPage() {
  redirect("/library");
}
