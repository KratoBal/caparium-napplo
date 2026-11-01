-- Lili 2026-11-01 (points 5 and 8): the chemical dosing log and the Kimutatások as PDFs made on the server are export runs too
ALTER TYPE "ExportKind" ADD VALUE 'PDF_DOSING';
ALTER TYPE "ExportKind" ADD VALUE 'PDF_REPORT';
