import { handle, parseJson } from "@/lib/api";
import { changeGroupMembers, groupMembersSchema } from "@/lib/animals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => changeGroupMembers(user, id, await parseJson(req, groupMembersSchema)));
}
