import { runTool } from "@/lib/tools";
import { readContext } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The website's buttons use exactly the same validated tools as the AI.
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = (await req.json().catch(() => ({}))) as { input?: unknown; ctx?: unknown };
  const result = runTool(name, body.input ?? {}, readContext(body.ctx));
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
