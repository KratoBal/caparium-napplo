import { handle, parseJson } from "@/lib/api";
import { fixGroupPlacements, groupPlacementFixSchema } from "@/lib/group-placement-fix";

export async function POST(req: Request) {
  return handle(req, async (user) => fixGroupPlacements(user, await parseJson(req, groupPlacementFixSchema)));
}
