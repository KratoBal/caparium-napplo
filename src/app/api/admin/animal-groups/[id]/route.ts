import { groupActiveSchema, setGroupActive } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

// switches a group off and on (Lili 2026-10-30, task caparium-csoport-inaktiv)
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => setGroupActive(user, id, await parseJson(req, groupActiveSchema)));
}
