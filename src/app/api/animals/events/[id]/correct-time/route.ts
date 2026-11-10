import { correctGroupChangeTime, groupChangeTimeSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

// a group change's moment corrected (the group card's from-to dates; card b98016a1)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => correctGroupChangeTime(user, id, await parseJson(req, groupChangeTimeSchema)));
}
