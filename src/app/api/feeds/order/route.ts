import { feedOrderSchema, setFeedOrder } from "@/lib/feeds";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => setFeedOrder(user, await parseJson(req, feedOrderSchema)));
}
