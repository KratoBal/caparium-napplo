import { handle, parseJson } from "@/lib/api";
import { planSchema, setFeedingPlan } from "@/lib/feeding-plan";

export async function POST(req: Request) {
  return handle(req, async (user) => setFeedingPlan(user, await parseJson(req, planSchema)));
}
