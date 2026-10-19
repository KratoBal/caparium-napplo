import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./auth";

/** For server components: the logged-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const store = await cookies();
  const user = await userForToken(store.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/belepes");
  return user;
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return userForToken(store.get(SESSION_COOKIE)?.value);
}
