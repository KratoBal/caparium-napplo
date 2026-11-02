import { handle, parseJson } from "@/lib/api";
import { fridgeInvalidateSchema, invalidateFridgeReading } from "@/lib/fridges";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateFridgeReading(user, id, await parseJson(req, fridgeInvalidateSchema)));
}
