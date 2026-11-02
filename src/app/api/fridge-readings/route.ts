import { handle, parseJson } from "@/lib/api";
import { fridgeReadingSchema, saveFridgeReading } from "@/lib/fridges";

export async function POST(req: Request) {
  return handle(req, async (user) => saveFridgeReading(user, await parseJson(req, fridgeReadingSchema)));
}
