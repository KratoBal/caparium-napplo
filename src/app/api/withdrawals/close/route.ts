import { handle, parseJson } from "@/lib/api";
import { closeSchema, closeWithdrawalDay } from "@/lib/withdrawal";

export async function POST(req: Request) {
  return handle(req, async (user) => closeWithdrawalDay(user, await parseJson(req, closeSchema)));
}
