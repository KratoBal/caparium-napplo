import type { SessionUser } from "@/lib/auth";
import type { HelperData } from "@/lib/helpers";
import { prisma } from "@/lib/db";
import { monogramResolver } from "@/lib/master";
import type { NavKey } from "@/lib/nav";
import { pageLang } from "@/lib/i18n/server";
import { reasonsRequired } from "@/lib/reasons";
import { businessDayOf, formatDay } from "@/lib/time";
import { ShellView } from "./ShellView";

export async function Shell({
  title,
  active,
  user,
  helper,
  guard,
  children,
}: {
  /**
   * Whether the main area is inert until hydration (HydratedMain). By default only with a user: the login is a native form. A page
   * without a user that holds a React-state form (Elfelejtett jelszó, the reset link's Új jelszó) asks for it (barracuda on #249).
   */
  guard?: boolean;
  /** none on the start page (Lili 2026-10-27 13:02 UTC): the bar keeps the day and the user */
  title?: string;
  active?: NavKey;
  user: SessionUser | null;
  /** AST-01: the page's helper, if it has one */
  helper?: HelperData | null;
  children: React.ReactNode;
}) {
  const today = formatDay(businessDayOf(new Date()));
  const lang = await pageLang(user);
  const reasons = await reasonsRequired(prisma);
  // the monogram of the phone's profile button (R-13: the one source); a user with none reads as the initials of the name
  const raw = user ? (await monogramResolver([user.id])).monogram(user.id, new Date()) : "";
  const monogram = user && (raw === user.fullName || raw.length > 4) ? user.fullName.split(/\s+/).map((w) => w.charAt(0).toLocaleUpperCase("hu")).join("") : raw;
  return (
    <ShellView title={title} active={active} user={user} helper={helper} guard={guard ?? user !== null} today={today} reasons={reasons} monogram={monogram} lang={lang}>
      {children}
    </ShellView>
  );
}
