import { handle, parseJson } from "@/lib/api";
import { createFeed, createFeedSchema } from "@/lib/feeds";

export async function POST(req: Request) {
  return handle(req, async (user) => createFeed(user, await parseJson(req, createFeedSchema)));
}
