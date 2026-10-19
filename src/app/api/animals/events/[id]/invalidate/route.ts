import { invalidateLifecycleEvent, lifecycleInvalidateSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateLifecycleEvent(user, id, await parseJson(req, lifecycleInvalidateSchema)));
}
