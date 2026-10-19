import { handle, parseJson } from "@/lib/api";
import { eatingSchema, setEatingStatus } from "@/lib/eating";

export async function POST(req: Request) {
  return handle(req, async (user) => setEatingStatus(user, await parseJson(req, eatingSchema)));
}
