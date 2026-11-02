// Lili 2026-11-01 (points 1-4): the export files' names
import { describe, expect, it } from "vitest";
import { FILE_BASE, periodFileName, waterFileBase } from "@/lib/exports/file-names";

describe("export file names", () => {
  it("names the water Excel after every pool or the chosen ones, ascii only", () => {
    expect(periodFileName(waterFileBase(null), "2026-11-01", "2026-11-01", "xlsx")).toBe("capasuli_teljes_vizmeres_2026-11-01.xlsx");
    expect(periodFileName(waterFileBase([]), "2026-10-26", "2026-11-01", "xlsx")).toBe("capasuli_teljes_vizmeres_2026-10-26_2026-11-01.xlsx");
    expect(periodFileName(waterFileBase(["Karantén", "Kis sózó"]), "2026-11-01", "2026-11-01", "xlsx")).toBe("Karanten_Kis-sozo_vizmeres_2026-11-01.xlsx");
  });
  it("gives the feeding exports Lili's names", () => {
    expect(periodFileName(FILE_BASE.feeding, "2026-11-01", "2026-11-01", "xlsx")).toBe("capasuli_takarmanynaplo_2026-11-01.xlsx");
    expect(periodFileName(FILE_BASE.eating, "2026-11-01", "2026-11-02", "xlsx")).toBe("capasuli_evesimintazat_2026-11-01_2026-11-02.xlsx");
    expect(periodFileName(FILE_BASE.withdrawal, "2026-11-01", "2026-11-01", "xlsx")).toBe("capasuli_takarmanykivetel_2026-11-01.xlsx");
  });
  it("names the fridges' temperature book capasuli_, the Excel and the PDF alike (task caparium-hutok)", () => {
    expect(periodFileName(FILE_BASE.fridges, "2026-11-01", "2026-11-30", "xlsx")).toBe("capasuli_hutok_homerseklete_2026-11-01_2026-11-30.xlsx");
    expect(periodFileName(FILE_BASE.fridges, "2026-11-02", "2026-11-02", "pdf")).toBe("capasuli_hutok_homerseklete_2026-11-02.pdf");
  });
});
