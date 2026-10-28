import { handle, parseJson } from "@/lib/api";
import { setSheetColor, sheetColorSchema } from "@/lib/sheet-colors";

export async function POST(req: Request) {
  return handle(req, async (user) => setSheetColor(user, await parseJson(req, sheetColorSchema)));
}
