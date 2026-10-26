import { handle, parseJson } from "@/lib/api";
import { createFeedingList, createListSchema } from "@/lib/feeding-lists";

export async function POST(req: Request) {
  return handle(req, async (user) => createFeedingList(user, await parseJson(req, createListSchema)));
}
