import { handle, parseJson } from "@/lib/api";
import { selectionSchema, setSelection } from "@/lib/feeding";

export async function POST(req: Request) {
  return handle(req, async (user) => setSelection(user, await parseJson(req, selectionSchema)));
}
