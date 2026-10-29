import { handle, parseJson } from "@/lib/api";
import { poolActiveSchema, setPoolActive } from "@/lib/admin";

export async function POST(req: Request) {
  return handle(req, async (user) => setPoolActive(user, await parseJson(req, poolActiveSchema)));
}
