import { createLifecycleEvent, lifecycleSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => createLifecycleEvent(user, await parseJson(req, lifecycleSchema)));
}
