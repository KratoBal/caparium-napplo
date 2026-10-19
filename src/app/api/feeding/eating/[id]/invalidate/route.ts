import { handle, parseJson } from "@/lib/api";
import { eatingInvalidateSchema, invalidateEatingStatus } from "@/lib/eating";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateEatingStatus(user, id, await parseJson(req, eatingInvalidateSchema)));
}
