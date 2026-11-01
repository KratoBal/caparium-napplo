import { handle, parseJson } from "@/lib/api";
import { feedPeriodsSchema, setFeedPeriods } from "@/lib/feed-periods";

// Lili 2026-11-01 (point 14): a feed's feeding periods, set together
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => setFeedPeriods(user, id, await parseJson(req, feedPeriodsSchema)));
}
