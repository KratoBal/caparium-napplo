import { poolVolumeSchema, setPoolVolume } from "@/lib/admin";
import { handle, parseJson } from "@/lib/api";

export async function POST(req: Request) {
  return handle(req, async (user) => setPoolVolume(user, await parseJson(req, poolVolumeSchema)));
}
