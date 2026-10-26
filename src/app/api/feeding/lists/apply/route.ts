import { handle, parseJson } from "@/lib/api";
import { applyFeedingList, applyListSchema } from "@/lib/feeding-lists";

export async function POST(req: Request) {
  return handle(req, async (user) => applyFeedingList(user, await parseJson(req, applyListSchema)));
}
