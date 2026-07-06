import "server-only";

import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseJsonField } from "@/lib/utils";
import { getCompanyContext } from "@/lib/company-context";

export async function getProfileContext(): Promise<string> {
  // data/company-context.md is the canonical context; the user_profile row
  // is the fallback for installs that haven't created the file.
  const companyContext = getCompanyContext();
  if (companyContext) return companyContext;

  const [row] = db
    .select()
    .from(userProfile)
    .where(eq(userProfile.id, "default"))
    .all();

  if (!row) return "";

  const parts: string[] = [];

  if (row.companyName) parts.push(`Company: ${row.companyName}`);
  if (row.companyDescription) parts.push(`Description: ${row.companyDescription}`);
  if (row.productsServices) parts.push(`Products/Services: ${row.productsServices}`);
  if (row.role) parts.push(`User role: ${row.role}`);

  const sectors = parseJsonField<string[]>(row.sectors);
  if (sectors?.length) parts.push(`Sectors: ${sectors.join(", ")}`);

  const jurisdictions = parseJsonField<string[]>(row.jurisdictionsOfInterest);
  if (jurisdictions?.length) parts.push(`Jurisdictions of interest: ${jurisdictions.join(", ")}`);

  const focusAreas = parseJsonField<string[]>(row.focusAreas);
  if (focusAreas?.length) parts.push(`Focus areas: ${focusAreas.join(", ")}`);

  if (row.freeText) parts.push(`Additional context: ${row.freeText}`);

  return parts.length > 0 ? parts.join("\n") : "";
}
