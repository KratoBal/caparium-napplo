import { handle, parseJson } from "@/lib/api";
import { plansSchema, setFeedingPlans } from "@/lib/feeding-plan";

export async function POST(req: Request) {
  return handle(req, async (user) => setFeedingPlans(user, await parseJson(req, plansSchema)));
}
