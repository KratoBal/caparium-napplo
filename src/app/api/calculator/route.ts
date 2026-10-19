import { handle, parseJson } from "@/lib/api";
import { calcSchema, runCalculator } from "@/lib/calculator";

export async function POST(req: Request) {
  return handle(req, async (user) => runCalculator(user, await parseJson(req, calcSchema)));
}
