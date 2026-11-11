import { activityCsv, clampPeriod, groupSaves, loadActivityRows, summarize } from "@/lib/activity";
import { userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, businessDayOf, isValidDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// Task caparium-aktivitas-idosav (Lili 2026-11-11): the activity page's summary as a CSV, the first and last save of each
// day and person included. Admins only, as the page; the same period rule (at most MAX_ACTIVITY_DAYS) and filter. It
// is the page's own data in another form, so it is not an export run of the zoo's records and writes no audit row.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return new Response("Jelentkezz be újra.", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Ehhez nincs jogosultságod.", { status: 403 });
  const url = new URL(req.url);
  const tol = url.searchParams.get("tol") ?? "";
  const ig = url.searchParams.get("ig") ?? "";
  const to = isValidDay(ig) ? ig : businessDayOf(new Date());
  const period = clampPeriod(isValidDay(tol) ? tol : addDays(to, -6), to);

  const users = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "AQUARIST"] } }, select: { id: true, fullName: true } });
  const ember = url.searchParams.get("ember") ?? undefined;
  const person = users.some((u) => u.id === ember) ? ember : undefined;
  const nameOf = (id: string) => users.find((u) => u.id === id)?.fullName ?? "ismeretlen felhasználó";

  const csv = activityCsv(summarize(groupSaves(await loadActivityRows(period, person))), nameOf);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aktivitas-${period.from}_${period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
