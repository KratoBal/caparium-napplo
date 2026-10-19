import { handle, parseJson } from "@/lib/api";
import { dayActionSchema, reopenDay } from "@/lib/journal";

export async function POST(req: Request) {
  return handle(req, async (user) => reopenDay(user, await parseJson(req, dayActionSchema)));
}
