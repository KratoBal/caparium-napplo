import { handle, parseJson } from "@/lib/api";
import { conversionSchema, setConversion } from "@/lib/conversion";

// Lili 2026-11-01 (point 13): a parameter's tester conversion from a day on, or its end
export async function POST(req: Request) {
  return handle(req, async (user) => setConversion(user, await parseJson(req, conversionSchema)));
}
