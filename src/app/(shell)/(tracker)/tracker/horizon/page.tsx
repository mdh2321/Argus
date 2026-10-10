import { permanentRedirect } from "next/navigation";

export default function RetiredHorizonPage() {
  permanentRedirect("/tracker?lifecycle=upcoming");
}
