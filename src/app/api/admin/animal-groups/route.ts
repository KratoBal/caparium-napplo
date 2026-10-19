import { createGroup, groupSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => createGroup(user, await parseJson(req, groupSchema)));
}
