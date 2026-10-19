import { createSpecies, speciesSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => createSpecies(user, await parseJson(req, speciesSchema)));
}
