import { handle, parseJson } from "@/lib/api";
import { setSubmissionState, submissionSchema } from "@/lib/exports/zims";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(req, async (user) => setSubmissionState(user, id, await parseJson(req, submissionSchema)));
}
