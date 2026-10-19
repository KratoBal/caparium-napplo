import { handle, parseJson } from "@/lib/api";
import { createZimsExport, zimsExportSchema } from "@/lib/exports/zims";

export async function POST(req: Request) {
  return handle(req, async (user) => createZimsExport(user, await parseJson(req, zimsExportSchema)));
}
