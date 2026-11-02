import { handle, parseJson } from "@/lib/api";
import { createFridge, fridgeSchema } from "@/lib/fridges";

export async function POST(req: Request) {
  return handle(req, async (user) => createFridge(user, await parseJson(req, fridgeSchema)));
}
