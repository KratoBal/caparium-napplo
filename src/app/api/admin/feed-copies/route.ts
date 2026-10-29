import { handle, parseJson } from "@/lib/api";
import { feedCopies, feedCopiesSchema } from "@/lib/feed-copies";

export async function POST(req: Request) {
  return handle(req, async (user) => feedCopies(user, await parseJson(req, feedCopiesSchema)));
}
