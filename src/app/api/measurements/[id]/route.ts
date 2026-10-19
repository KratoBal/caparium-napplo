import { handle, parseJson } from "@/lib/api";
import { updateMeasurement, updateSchema } from "@/lib/measurements";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => updateMeasurement(user, id, await parseJson(req, updateSchema)));
}
