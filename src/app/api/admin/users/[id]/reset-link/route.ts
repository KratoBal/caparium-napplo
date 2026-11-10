import { z } from "zod";
import { createPasswordResetLink } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

// task e7f9e84d, slice 3: an admin makes a one-time reset link for a user and hands it over
const bodySchema = z.object({ requestId: z.string().min(8).max(100) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => createPasswordResetLink(user, id, (await parseJson(req, bodySchema)).requestId));
}
