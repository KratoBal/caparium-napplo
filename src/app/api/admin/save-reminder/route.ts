import { handle, parseJson } from "@/lib/api";
import { saveReminderSchema, setSaveReminder } from "@/lib/save-reminder-setting";

export async function POST(req: Request) {
  return handle(req, async (user) => setSaveReminder(user, await parseJson(req, saveReminderSchema)));
}
