import { handle, parseJson } from "@/lib/api";
import { parameterOrderSchema, setParameterOrder } from "@/lib/parameter-order";

// Lili 2026-11-02 (acrobot 39956, point 4): one order of the water measurements everywhere
export async function POST(req: Request) {
  return handle(req, async (user) => setParameterOrder(user, await parseJson(req, parameterOrderSchema)));
}
