import { handle, parseJson } from "@/lib/api";
import { bodyWeightSchema, recordBodyWeight } from "@/lib/calculator";

export async function POST(req: Request) {
  return handle(req, async (user) => recordBodyWeight(user, await parseJson(req, bodyWeightSchema)));
}
