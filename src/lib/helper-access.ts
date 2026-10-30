import { prisma } from "./db";
import type { StockAccess } from "./helpers";
import { moduleLevel } from "./master";
import type { SessionUser } from "./auth";

/** What the helper may tell this user about stock: the chemicals (dosing module) and the freezer's feed (withdrawal module). */
export async function helperStockAccess(user: Pick<SessionUser, "id" | "role">): Promise<Exclude<StockAccess, boolean>> {
  const [dosing, withdrawal] = await Promise.all([moduleLevel(prisma, user.id, user.role, "DOSING"), moduleLevel(prisma, user.id, user.role, "WITHDRAWAL")]);
  return { chemicals: dosing !== "NONE", feed: withdrawal !== "NONE" };
}
