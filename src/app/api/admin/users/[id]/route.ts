import { updateUser, updateUserSchema } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => updateUser(user, id, await parseJson(req, updateUserSchema)));
}
