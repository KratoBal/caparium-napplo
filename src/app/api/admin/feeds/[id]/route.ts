import { handle, parseJson } from "@/lib/api";
import { updateFeed, updateFeedSchema } from "@/lib/feeds";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => updateFeed(user, id, await parseJson(req, updateFeedSchema)));
}
