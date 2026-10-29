import { poolSystemSchema, setPoolSystem } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => setPoolSystem(user, await parseJson(req, poolSystemSchema)));
}
