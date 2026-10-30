import { handle, parseJson } from "@/lib/api";
import { intakeInvalidateSchema, invalidateIntakeItem } from "@/lib/feed-intake";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateIntakeItem(user, id, await parseJson(req, intakeInvalidateSchema)));
}
