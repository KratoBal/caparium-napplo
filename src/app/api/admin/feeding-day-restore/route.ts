import { handle, parseJson } from "@/lib/api";
import { restoreDay, restoreSchema } from "@/lib/day-restore";

export async function POST(req: Request) {
  return handle(req, async (user) => restoreDay(user, await parseJson(req, restoreSchema)));
}
