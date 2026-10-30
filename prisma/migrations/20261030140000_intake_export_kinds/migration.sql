-- The Takarmányhűtő report (Lili 2026-10-30): its two files are export runs too, as the withdrawal Excel is (KIV-05)
ALTER TYPE "ExportKind" ADD VALUE 'EXCEL_INTAKE';
ALTER TYPE "ExportKind" ADD VALUE 'PDF_INTAKE';
