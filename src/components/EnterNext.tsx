"use client";

import { useEffect } from "react";
import { attachEnterNext, type EnterDocument } from "@/lib/enter-next";

/**
 * Mounted once in the root layout: Enter in a number field closes the value and moves to the next field, on every
 * page (Lili, acrobot 45552). The rule is in `lib/enter-next.ts`; it never saves, closes a day or submits a form.
 */
export function EnterNext() {
  useEffect(() => attachEnterNext(document as unknown as EnterDocument), []);
  return null;
}
