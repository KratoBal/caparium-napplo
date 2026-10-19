import { handle, parseJson } from "@/lib/api";
import { iconSchema, setIcon } from "@/lib/icons";

export async function POST(req: Request) {
  return handle(req, async (user) => setIcon(user, await parseJson(req, iconSchema)));
}
