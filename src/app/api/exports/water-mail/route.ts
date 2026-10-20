import { handle, parseJson } from "@/lib/api";
import { sendSchema, sendWaterReport } from "@/lib/water-mail";

export async function POST(req: Request) {
  return handle(req, async (user) => sendWaterReport(user, await parseJson(req, sendSchema)));
}
