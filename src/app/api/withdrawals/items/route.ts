import { handle, parseJson } from "@/lib/api";
import { saveWithdrawalItem, withdrawalSchema } from "@/lib/withdrawal";

export async function POST(req: Request) {
  return handle(req, async (user) => saveWithdrawalItem(user, await parseJson(req, withdrawalSchema)));
}
