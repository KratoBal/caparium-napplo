"use client";

// TAK-05: the log as PDF through the browser's print dialog ("Mentés PDF-ként"); the print stylesheet
// leaves out the navigation and the forms. No PDF library on the server.
export function PrintButton() {
  return (
    <button className="btn btn-soft no-print" type="button" onClick={() => window.print()} data-testid="print">
      Nyomtatás / PDF
    </button>
  );
}
