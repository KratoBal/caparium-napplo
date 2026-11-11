import { handle, parseJson } from "@/lib/api";
import { feedingModeSchema, setFeedingMode } from "@/lib/feeding";

export async function POST(req: Request) {
  return handle(req, async (user) => setFeedingMode(user, await parseJson(req, feedingModeSchema)));
}
