import type {
  AskArgusAnswer,
  AskConversationalAnswer,
  AskArgusCitation,
} from "@/lib/ask-types";

/** SSE events emitted by /api/ask/stream (deep report + conversational). */
export type StreamEvent =
  | { type: "sources"; sources: AskArgusCitation[] }
  | { type: "progress"; chars: number }
  | { type: "delta"; text: string }
  | { type: "done"; answer: AskArgusAnswer & Partial<AskConversationalAnswer> }
  | { type: "error"; message: string };

/** Read an SSE response body, invoking `onEvent` for each parsed `data:` event. */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: StreamEvent) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
    }
  }
}
