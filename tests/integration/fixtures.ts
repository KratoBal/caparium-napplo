import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/measurements";

export async function fixtures() {
  const users = await prisma.user.findMany();
  const u = (loginId: string): Actor => {
    const x = users.find((v) => v.loginId === loginId);
    if (!x) throw new Error(`missing seed user ${loginId}`);
    return { id: x.id, role: x.role };
  };
  const groups = await prisma.measurementGroup.findMany();
  const pools = await prisma.pool.findMany();
  const params = await prisma.parameter.findMany();
  const byCode = <T extends { code: string; id: string }>(rows: T[], code: string) => {
    const r = rows.find((v) => v.code === code);
    if (!r) throw new Error(`missing seed row ${code}`);
    return r.id;
  };
  return {
    admin: u("teszt.admin"),
    aq1: u("teszt.akvarista1"),
    aq2: u("teszt.akvarista2"),
    group: (c: string) => byCode(groups, c),
    pool: (c: string) => byCode(pools, c),
    param: (c: string) => byCode(params, c),
  };
}

let n = 0;
export function rid(prefix = "req"): string {
  n += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${n}`;
}

/** Budapest local "YYYY-MM-DDTHH:mm" in summer time -> instant */
export function cest(local: string): Date {
  return new Date(`${local}:00+02:00`);
}
