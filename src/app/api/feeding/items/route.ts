import { handle, parseJson } from "@/lib/api";
import { itemSchema, saveFeedingItem } from "@/lib/feeding";

export async function POST(req: Request) {
  return handle(req, async (user) => saveFeedingItem(user, await parseJson(req, itemSchema)));
}
