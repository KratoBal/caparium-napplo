import type { AppModule } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./auth";
import { prisma } from "./db";
import { moduleLevel } from "./master";
import type { Level } from "./permissions";

/** For server components: the logged-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const store = await cookies();
  const user = await userForToken(store.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/belepes");
  return user;
}

/**
 * The logged-in user with at least read access to a module (R-17: an explicit NONE
 * override hides the module, reading included). Otherwise a redirect to the no-access page.
 */
export async function requireModuleRead(module: AppModule): Promise<{ user: SessionUser; level: Level }> {
  const user = await requireUser();
  const level = await moduleLevel(prisma, user.id, user.role, module);
  if (level === "NONE") redirect("/nincs-jogosultsag");
  return { user, level };
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return userForToken(store.get(SESSION_COOKIE)?.value);
}
