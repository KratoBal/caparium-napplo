import { createPool, createPoolSchema } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => createPool(user, await parseJson(req, createPoolSchema)));
}
