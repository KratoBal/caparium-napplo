import { handle, parseJson } from "@/lib/api";
import { updateFeedingList, updateListSchema } from "@/lib/feeding-lists";

export async function POST(req: Request) {
  return handle(req, async (user) => updateFeedingList(user, await parseJson(req, updateListSchema)));
}
