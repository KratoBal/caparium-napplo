import { handle, parseJson } from "@/lib/api";
import { invalidateWithdrawalItem, withdrawalInvalidateSchema } from "@/lib/withdrawal";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => invalidateWithdrawalItem(user, id, await parseJson(req, withdrawalInvalidateSchema)));
}
