import { handle, parseJson } from "@/lib/api";
import { invalidateMeasurement, invalidateSchema } from "@/lib/measurements";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateMeasurement(user, id, await parseJson(req, invalidateSchema)));
}
