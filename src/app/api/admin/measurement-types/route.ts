import { handle, parseJson } from "@/lib/api";
import { createMeasurementType, newMeasurementSchema } from "@/lib/new-measurement";

// Lili 2026-11-01 (point 9): a new measurement type in some pools of a daily or weekly group
export async function POST(req: Request) {
  return handle(req, async (user) => createMeasurementType(user, await parseJson(req, newMeasurementSchema)));
}
