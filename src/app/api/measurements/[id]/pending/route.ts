import { handle, parseJson } from "@/lib/api";
import { decidePending, pendingDecisionSchema } from "@/lib/pending";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => decidePending(user, id, await parseJson(req, pendingDecisionSchema)));
}
