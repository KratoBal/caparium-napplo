import { readCookie, SESSION_COOKIE } from "@/lib/auth";
import { handle, parseJson } from "@/lib/api";
import { ownProfileSchema, updateOwnProfile } from "@/lib/own-profile";

// Lili 2026-11-01 (point 11): the user's own password and display name
export async function PATCH(req: Request) {
  return handle(req, async (user) =>
    updateOwnProfile(user, await parseJson(req, ownProfileSchema), {
      token: readCookie(req.headers.get("cookie"), SESSION_COOKIE),
      client: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    }),
  );
}
