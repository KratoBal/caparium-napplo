import { handle, parseJson } from "@/lib/api";
import { archiveFeedingList, archiveListSchema } from "@/lib/feeding-lists";

export async function POST(req: Request) {
  return handle(req, async (user) => archiveFeedingList(user, await parseJson(req, archiveListSchema)));
}
