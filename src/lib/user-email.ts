// A user's own e-mail address (task e7f9e84d, Lili 2026-11-01 20:01 UTC: a convenient password reset before live use). It is
// OPTIONAL: a user without one keeps the admin's password change. Stored trimmed and lower-case, unique across users, so a reset
// request by address finds one account at most. "" clears it.
import { z } from "zod";

export const EMAIL_TAKEN = "Ez az e-mail cím már egy másik felhasználónál van.";

export const userEmailField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.union([z.literal(""), z.string().max(254).email("Érvényes e-mail címet adj meg.")]),
);

/** "" (cleared) as null, a value trimmed and lower-case (again here: a caller may skip the schema). */
export const emailOrNull = (v: string | undefined): string | null | undefined => {
  if (v === undefined) return undefined;
  const value = v.trim().toLowerCase();
  return value === "" ? null : value;
};
