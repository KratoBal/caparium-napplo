import { handle, parseJson } from "@/lib/api";
import { finalizeList, finalizeSchema } from "@/lib/feeding";

export async function POST(req: Request) {
  return handle(req, async (user) => finalizeList(user, await parseJson(req, finalizeSchema)));
}
