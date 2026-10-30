// The admin's switch of the save reminder (card 0d617f0c). The rows are written at a time of their own in 2028, as the
// recipients' tests write in 2027, so what the other files read now does not change.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { AppError } from "@/lib/errors";
import { saveReminderOn, setSaveReminder } from "@/lib/save-reminder-setting";
import { cest, fixtures, rid } from "./fixtures";

const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AppError).code);
let f: Awaited<ReturnType<typeof fixtures>>;

beforeAll(async () => {
  f = await fixtures();
});

describe("the save reminder switch", () => {
  it("is on until an admin switches it off; an aquarist cannot; the change is audited; the same value again is refused", async () => {
    const at = cest("2028-03-01T10:00");
    expect(await saveReminderOn(prisma, at), "on by default").toBe(true);
    expect(await code(setSaveReminder(f.aq1, { requestId: rid(), on: false }, at))).toBe("ADMIN_ONLY");
    expect(await saveReminderOn(prisma, at)).toBe(true);

    const off = rid();
    await setSaveReminder(f.admin, { requestId: off, on: false }, at);
    expect(await saveReminderOn(prisma, cest("2028-03-01T10:01"))).toBe(false);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { requestId: off } });
    expect(audit).toMatchObject({ userId: f.admin.id, action: "MASTER_CHANGE", entityType: "Setting" });
    expect(audit.changes).toEqual({ save_reminder: { before: "true", after: "false" } });

    // the same request again is a replay, not a second row
    expect(await setSaveReminder(f.admin, { requestId: off, on: false }, cest("2028-03-01T10:02"))).toEqual({ replayed: true });
    expect(await code(setSaveReminder(f.admin, { requestId: rid(), on: false }, cest("2028-03-01T10:03")))).toBe("NO_CHANGE");

    await setSaveReminder(f.admin, { requestId: rid(), on: true }, cest("2028-03-01T10:04"));
    expect(await saveReminderOn(prisma, cest("2028-03-01T10:05"))).toBe(true);
  });
});
