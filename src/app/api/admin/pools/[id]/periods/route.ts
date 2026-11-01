import { handle, parseJson } from "@/lib/api";
import { poolPeriodsSchema, setPoolPeriods } from "@/lib/pool-periods";

// Lili 2026-11-01 (point 16): a pool's periods of use, set together
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => setPoolPeriods(user, id, await parseJson(req, poolPeriodsSchema)));
}
