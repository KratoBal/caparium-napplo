import { animalOrderSchema, setAnimalOrder } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => setAnimalOrder(user, await parseJson(req, animalOrderSchema)));
}
