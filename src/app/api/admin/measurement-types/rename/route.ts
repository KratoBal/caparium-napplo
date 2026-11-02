import { handle, parseJson } from "@/lib/api";
import { renameMeasurementType, renameSchema } from "@/lib/measurement-types";

// Lili 2026-11-02 (acrobot 39956, 39960): the Vízmérések card's operations (src/lib/measurement-types.ts)
export async function POST(req: Request) {
  return handle(req, async (user) => renameMeasurementType(user, await parseJson(req, renameSchema)));
}
