import { setReference, referenceSchema } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => setReference(user, await parseJson(req, referenceSchema)));
}
