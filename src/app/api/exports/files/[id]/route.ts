import { userFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { moduleLevel } from "@/lib/master";

// Hands out the stored bytes of an export file unchanged (the submitted file is the evidence).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await userFromRequest(req);
  if (!user) return new Response("Jelentkezz be újra.", { status: 401 });
  if ((await moduleLevel(prisma, user.id, user.role, "EXPORT")) === "NONE") {
    return new Response("Exportálásra nincs jogosultságod.", { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Nem található.", { status: 404 });
  const f = await prisma.exportFile.findUnique({ where: { id } });
  if (!f || f.content === null) return new Response("Nem található.", { status: 404 });
  return new Response(f.content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${f.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
