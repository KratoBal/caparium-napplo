import { handle, parseJson } from "@/lib/api";
import { updateChemical, updateChemicalSchema } from "@/lib/dosing";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => updateChemical(user, id, await parseJson(req, updateChemicalSchema)));
}
