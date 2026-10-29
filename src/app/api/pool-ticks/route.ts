import { handle, parseJson } from "@/lib/api";
import { poolTickSchema, setPoolTick } from "@/lib/pool-ticks";

export async function POST(req: Request) {
  return handle(req, async (user) => setPoolTick(user, await parseJson(req, poolTickSchema)));
}
