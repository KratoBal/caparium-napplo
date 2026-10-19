import { handle, parseJson } from "@/lib/api";
import { dosingSchema, saveDosing } from "@/lib/dosing";

export async function POST(req: Request) {
  return handle(req, async (user) => saveDosing(user, await parseJson(req, dosingSchema)));
}
