// The monthly ZIMS mail's silent skips (acrobot and Lili, 2026-11-01): an instance that is not switched on, or a setting with no
// recipient, left no trace, so "the October package did not come" could not be told from a fault. One log line says which.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailMonthlyPackage, SKIP_NOTE } from "@/lib/zims-mail";

const pkg = { created: false, runId: "00000000-0000-0000-0000-000000000000" };
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.CAPARIUM_MONTHLY_ZIMS_MAIL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CAPARIUM_MONTHLY_ZIMS_MAIL;
  else process.env.CAPARIUM_MONTHLY_ZIMS_MAIL = saved;
  vi.restoreAllMocks();
});

describe("the hourly try of the monthly ZIMS mail leaves a line when it skips for the instance", () => {
  it("not switched on (unset, empty, or anything but on): DISABLED, and one line that names the variable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const v of [undefined, "", "off", "ON", "1"]) {
      if (v === undefined) delete process.env.CAPARIUM_MONTHLY_ZIMS_MAIL;
      else process.env.CAPARIUM_MONTHLY_ZIMS_MAIL = v;
      expect(await mailMonthlyPackage(pkg)).toEqual({ sent: false, why: "DISABLED" });
    }
    expect(log).toHaveBeenCalledTimes(5);
    expect(log.mock.calls.every((c) => c[0] === SKIP_NOTE.DISABLED)).toBe(true);
    expect(SKIP_NOTE.DISABLED).toContain("CAPARIUM_MONTHLY_ZIMS_MAIL");
  });

  it("the note names the cause and where to turn it, and no value", () => {
    expect(SKIP_NOTE.NO_RECIPIENT).toContain("Havi ZIMS-csomag levélben");
    expect(Object.values(SKIP_NOTE).join(" ")).not.toMatch(/@|password|jelszó/i);
  });
});
