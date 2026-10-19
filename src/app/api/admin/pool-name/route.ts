import { poolNameSchema, renamePool } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => renamePool(user, await parseJson(req, poolNameSchema)));
}
