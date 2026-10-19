import { handle, parseJson } from "@/lib/api";
import { bodyWeightInvalidateSchema, invalidateBodyWeight } from "@/lib/calculator";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateBodyWeight(user, id, await parseJson(req, bodyWeightInvalidateSchema)));
}
