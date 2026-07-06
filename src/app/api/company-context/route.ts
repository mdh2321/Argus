import { NextRequest, NextResponse } from "next/server";
import { getCompanyContextRaw, writeCompanyContextRaw } from "@/lib/company-context";

export async function GET() {
  const content = getCompanyContextRaw();
  return NextResponse.json({ content: content ?? "", exists: content !== null });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  writeCompanyContextRaw(body.content);
  return NextResponse.json({ ok: true });
}
