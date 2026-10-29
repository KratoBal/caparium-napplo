// The monthly ZIMS mail's words (Lili's package 2026-10-29): the month named in Hungarian, the warning clearly a warning.
import { describe, expect, it } from "vitest";
import { zimsMonthLabel, zimsPackageSubject, zimsPackageText, zimsWarningSubject, zimsWarningText } from "@/lib/zims-mail-text";

describe("the monthly ZIMS mail text", () => {
  it("names the month in Hungarian", () => {
    expect(zimsMonthLabel("2026-10-01")).toBe("2026. október");
    expect(zimsMonthLabel("2027-01-01")).toBe("2027. január");
  });
  it("the package letter lists the attachments and says it is a preview", () => {
    expect(zimsPackageSubject("2026-10-01")).toBe("Cápasuli ZIMS-csomag - 2026. október");
    const text = zimsPackageText("2026-10-01", ["2026_Nagymedence_10_ZIMSimport.csv", "2026_Kismedence_10_ZIMSimport.csv"]);
    expect(text).toContain("- 2026_Nagymedence_10_ZIMSimport.csv\n- 2026_Kismedence_10_ZIMSimport.csv");
    expect(text).toContain("előnézet");
  });
  it("the warning says why, and starts with the word", () => {
    expect(zimsWarningSubject("2026-10-01")).toBe("FIGYELMEZTETÉS: nincs ZIMS-csomag - 2026. október");
    expect(zimsWarningText("2026-10-01", "a hónapban nincs érvényes mérés.")).toContain("nem készült ZIMS-csomag: a hónapban nincs érvényes mérés.");
  });
});
