import { handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { moduleLevel } from "@/lib/master";
import { getGrid } from "@/lib/queries";
import { isValidDay } from "@/lib/time";

export async function GET(req: Request) {
  return handle(
    req,
    async (user) => {
      if ((await moduleLevel(prisma, user.id, user.role, "WATER")) === "NONE") {
        throw new AppError(403, "NO_ACCESS", "Ehhez a modulhoz nincs jogosultságod.");
      }
      const url = new URL(req.url);
      const groupId = url.searchParams.get("groupId") ?? "";
      const day = url.searchParams.get("day") ?? "";
      const round = Number(url.searchParams.get("round") ?? "") || undefined;
      if (!/^[0-9a-f-]{36}$/.test(groupId) || !isValidDay(day)) throw new AppError(400, "BAD_REQUEST", "Hibás kérés.");
      const grid = await getGrid(groupId, day, round);
      if (!grid) throw new AppError(404, "GROUP_NOT_FOUND", "A mérési csoport nem található.");
      return grid;
    },
    { write: false },
  );
}
