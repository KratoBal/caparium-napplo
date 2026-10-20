import { z } from "zod";
import { handle, parseJson } from "@/lib/api";
import { loadInitialAnimalsByAdmin } from "@/lib/initial-animals";

const schema = z.object({ requestId: z.string().min(8).max(100) });

export async function POST(req: Request) {
  return handle(req, async (user) => loadInitialAnimalsByAdmin(user, (await parseJson(req, schema)).requestId));
}
