import { handle, parseJson } from "@/lib/api";
import { recipientSchema, setRecipientSetting } from "@/lib/water-mail";

export async function POST(req: Request) {
  return handle(req, async (user) => setRecipientSetting(user, await parseJson(req, recipientSchema), "monthly_zims_recipient"));
}
