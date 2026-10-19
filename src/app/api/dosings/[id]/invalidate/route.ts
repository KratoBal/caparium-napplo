import { handle, parseJson } from "@/lib/api";
import { dosingInvalidateSchema, invalidateDosing } from "@/lib/dosing";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateDosing(user, id, await parseJson(req, dosingInvalidateSchema)));
}
