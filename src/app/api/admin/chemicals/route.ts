import { handle, parseJson } from "@/lib/api";
import { chemicalSchema, createChemical } from "@/lib/dosing";

export async function POST(req: Request) {
  return handle(req, async (user) => createChemical(user, await parseJson(req, chemicalSchema)));
}
