import { handle, parseJson } from "@/lib/api";
import { dayFeedsSchema, setDayFeeds } from "@/lib/feeding";

export async function POST(req: Request) {
  return handle(req, async (user) => setDayFeeds(user, await parseJson(req, dayFeedsSchema)));
}
