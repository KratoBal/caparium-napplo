import { editAnimal, editAnimalSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => editAnimal(user, id, await parseJson(req, editAnimalSchema)));
}
