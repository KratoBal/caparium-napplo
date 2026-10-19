-- Stage 2 exports (EGY-10, EVE-07): the feeding and the eating Excel are export runs too (audit, K6)
ALTER TYPE "ExportKind" ADD VALUE 'EXCEL_FEEDING';
ALTER TYPE "ExportKind" ADD VALUE 'EXCEL_EATING';
