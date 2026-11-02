import { handle, parseJson } from "@/lib/api";
import { setMeasurementLimits, limitsSchema } from "@/lib/measurement-types";

// Lili 2026-11-02 (acrobot 39956, 39960): the Vízmérések card's operations (src/lib/measurement-types.ts)
export async function POST(req: Request) {
  return handle(req, async (user) => setMeasurementLimits(user, await parseJson(req, limitsSchema)));
}
