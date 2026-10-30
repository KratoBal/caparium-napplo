import { handle, parseJson } from "@/lib/api";
import { setStockStart, stockStartSchema } from "@/lib/feed-intake";

export async function POST(req: Request) {
  return handle(req, async (user) => setStockStart(user, await parseJson(req, stockStartSchema)));
}
