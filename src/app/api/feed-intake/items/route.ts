import { handle, parseJson } from "@/lib/api";
import { intakeSchema, saveIntakeItem } from "@/lib/feed-intake";

export async function POST(req: Request) {
  return handle(req, async (user) => saveIntakeItem(user, await parseJson(req, intakeSchema)));
}
