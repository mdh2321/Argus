import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { storyReferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDeliveredDigestStory, sendTelegramReply } from "@/lib/digest-pipeline/deliver";

export const maxDuration = 60;

// D3 — two-way digest. Telegram calls this webhook with each update. Replying
// to the delivered digest with `track <n>` creates the tracker entry for the
// nth numbered story (preliminary analysis kicked off by the from-reference
// path), and the bot confirms in-channel. Read the digest on your phone; the
// entries exist by the time you're at your desk.

interface TelegramMessage {
  message_id: number;
  chat?: { id: number | string };
  text?: string;
}
interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export async function POST(request: NextRequest) {
  // Telegram secret-token verification, when configured. A mismatch is a
  // forged request — reject it.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const msg = update?.message ?? update?.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim() ?? "";

  // Always 200 to Telegram unless auth failed — a non-200 makes Telegram retry.
  if (!msg || chatId === undefined) return NextResponse.json({ ok: true });

  // Only act on the configured owner chat; ignore everything else silently.
  const allowedChat = process.env.DIGEST_TELEGRAM_CHAT_ID;
  if (allowedChat && String(chatId) !== String(allowedChat)) {
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/?track\s+(\d+)\b/i);
  if (!match) {
    // Only nudge on a clearly-intended-but-malformed track command.
    if (/^\/?track\b/i.test(text)) {
      await safeReply(chatId, "Usage: <code>track &lt;n&gt;</code> — e.g. <code>track 3</code> to add story 3.", msg.message_id);
    }
    return NextResponse.json({ ok: true });
  }

  const n = parseInt(match[1], 10);
  try {
    await handleTrack(request, chatId, msg.message_id, n);
  } catch (err) {
    console.error("[telegram-webhook] track failed:", err);
    await safeReply(chatId, "Something went wrong adding that story. Try again from Sentinel.", msg.message_id);
  }
  return NextResponse.json({ ok: true });
}

async function handleTrack(
  request: NextRequest,
  chatId: number | string,
  replyTo: number,
  n: number
) {
  const resolved = getDeliveredDigestStory(n);
  if (!resolved) {
    await safeReply(chatId, `Couldn't find story ${n} in the latest digest.`, replyTo);
    return;
  }
  const { story } = resolved;

  // Find a trackable, not-yet-tracked reference on the story.
  const refs = db
    .select()
    .from(storyReferences)
    .where(eq(storyReferences.storyId, story.id))
    .all();
  const unmatched = refs.find((r) => r.status === "unmatched" && r.proposedShortName);

  if (!unmatched) {
    const alreadyMatched = refs.some((r) => r.status === "matched" && r.entryId);
    await safeReply(
      chatId,
      alreadyMatched
        ? `Story ${n} is already tracked. ✅`
        : `No trackable instrument found in story ${n}.`,
      replyTo
    );
    return;
  }

  // Reuse the existing from-reference creation path via a same-origin call, so
  // the entry is drafted and a preliminary analysis is kicked off identically
  // to the in-app "track this reference" action.
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/api/tracker/entries/from-reference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referenceId: unmatched.id }),
  });
  const data = (await res.json().catch(() => ({}))) as { entryId?: string; error?: string };

  if (res.status === 409 && data.entryId) {
    await safeReply(chatId, `Story ${n} is already tracked. ✅`, replyTo);
    return;
  }
  if (!res.ok || !data.entryId) {
    await safeReply(chatId, `Couldn't add story ${n}: ${data.error ?? `HTTP ${res.status}`}`, replyTo);
    return;
  }

  const name = unmatched.proposedShortName ?? unmatched.text;
  await safeReply(
    chatId,
    `✅ Tracking <b>${escapeHtml(name)}</b> — preliminary analysis in progress.\n${origin}/tracker/${data.entryId}`,
    replyTo
  );
}

async function safeReply(chatId: number | string, html: string, replyTo?: number) {
  try {
    await sendTelegramReply(chatId, html, replyTo);
  } catch (err) {
    console.error("[telegram-webhook] reply failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
