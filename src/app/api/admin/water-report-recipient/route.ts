import { handle, parseJson } from "@/lib/api";
import { recipientSchema, setWaterReportRecipient } from "@/lib/water-mail";

export async function POST(req: Request) {
  return handle(req, async (user) => setWaterReportRecipient(user, await parseJson(req, recipientSchema)));
}
