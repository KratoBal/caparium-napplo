import { handle, parseJson } from "@/lib/api";
import { dayActionSchema, recloseDay } from "@/lib/journal";

export async function POST(req: Request) {
  return handle(req, async (user) => recloseDay(user, await parseJson(req, dayActionSchema)));
}
