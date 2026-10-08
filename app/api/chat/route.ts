import { ApiError } from "@google/genai";
import { z } from "zod";
import { ChatError, runChat } from "@/lib/ai";
import { readContext } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
    actions: z.string().max(20000).optional(),
  })).min(1).max(60),
  view: z.object({ page: z.string().max(40).optional(), date: z.string().max(10).optional() }).optional(),
  ctx: z.unknown().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That message couldn't be read. Try again." }, { status: 400 });
  const { messages, view, ctx } = parsed.data;

  try {
    const out = await runChat(messages, view ?? {}, readContext(ctx));
    return Response.json(out);
  } catch (err) {
    let error = "The AI couldn't finish that. Try again in a moment.";
    if (err instanceof ChatError) error = err.message;
    else if (err instanceof ApiError) {
      const msg = err.message || "";
      if (/api key|API_KEY_INVALID|permission/i.test(msg) || err.status === 401 || err.status === 403) {
        error = "Your Gemini API key was rejected. Check GEMINI_API_KEY in the .env file, then restart the website.";
      } else if (err.status === 404) {
        error = "That Gemini model wasn't found. Check GEMINI_MODEL in the .env file.";
      } else if (/location|region|not supported/i.test(msg)) {
        error = "The Gemini API isn't available in your region with this key.";
      }
    }
    console.error("Chat error:", err);
    return Response.json({ error }, { status: 500 });
  }
}
