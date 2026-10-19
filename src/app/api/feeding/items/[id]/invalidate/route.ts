import { handle, parseJson } from "@/lib/api";
import { invalidateFeedingItem, itemInvalidateSchema } from "@/lib/feeding";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateFeedingItem(user, id, await parseJson(req, itemInvalidateSchema)));
}
