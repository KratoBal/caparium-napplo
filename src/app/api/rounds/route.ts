import { handle, parseJson } from "@/lib/api";
import { newRoundSchema, openNewRound } from "@/lib/measurements";

export async function POST(req: Request) {
  return handle(req, async (user) => {
    const { round, replayed } = await openNewRound(user, await parseJson(req, newRoundSchema));
    return { round: { id: round.id, seq: round.seq }, replayed };
  });
}
