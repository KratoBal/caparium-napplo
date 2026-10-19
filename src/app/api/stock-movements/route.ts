import { handle, parseJson } from "@/lib/api";
import { intakeSchema, recordMovement } from "@/lib/dosing";

export async function POST(req: Request) {
  return handle(req, async (user) => recordMovement(user, await parseJson(req, intakeSchema)));
}
