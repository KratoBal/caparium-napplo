import { handle, parseJson } from "@/lib/api";
import { dilutionRecalc, dilutionRecalcSchema } from "@/lib/dilution-recalc";

export async function POST(req: Request) {
  return handle(req, async (user) => dilutionRecalc(user, await parseJson(req, dilutionRecalcSchema)));
}
