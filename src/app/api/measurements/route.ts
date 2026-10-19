import { handle, parseJson } from "@/lib/api";
import { createMeasurement, createSchema } from "@/lib/measurements";

export async function POST(req: Request) {
  return handle(req, async (user) => createMeasurement(user, await parseJson(req, createSchema)));
}
