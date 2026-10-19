import { handle, parseJson } from "@/lib/api";
import { applyPlan, applySchema } from "@/lib/feeding-plan";

export async function POST(req: Request) {
  return handle(req, async (user) => applyPlan(user, await parseJson(req, applySchema)));
}
