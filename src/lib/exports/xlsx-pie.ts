// Pie charts in an .xlsx (Lili 2026-11-01, point 4: a weekly pie of the withdrawn feeds). ExcelJS writes no charts, so the
// chart parts are added to the finished file: one drawing on the sheet, one chart part per pie, the content types and the
// relationships. Each chart reads its labels and values from cells of the sheet (with a cache of the same values, so a
// viewer that does not recalculate shows them too).
import JSZip from "jszip";

export type Pie = {
  title: string;
  /** the label cells and the value cells, 1-based rows, one column each (e.g. A3:A7 and B3:B7) */
  labelCol: number;
  valueCol: number;
  firstRow: number;
  lastRow: number;
  labels: string[];
  values: number[];
  /** where the chart stands: the top left cell (1-based) and its size in columns and rows */
  at: { col: number; row: number; cols: number; rows: number };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function ref(sheet: string, col: number, first: number, last: number): string {
  const c = colLetter(col);
  return `'${sheet.replace(/'/g, "''")}'!$${c}$${first}:$${c}$${last}`;
}

export function chartXml(sheet: string, p: Pie): string {
  const n = p.labels.length;
  const strPts = p.labels.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join("");
  const numPts = p.values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("");
  const labels =
    '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<c:roundedCorners val="0"/><c:chart>' +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(p.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/>' +
    '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>g</c:v></c:tx>' +
    labels +
    `<c:cat><c:strRef><c:f>${esc(ref(sheet, p.labelCol, p.firstRow, p.lastRow))}</c:f><c:strCache><c:ptCount val="${n}"/>${strPts}</c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${esc(ref(sheet, p.valueCol, p.firstRow, p.lastRow))}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${numPts}</c:numCache></c:numRef></c:val>` +
    '</c:ser><c:firstSliceAng val="0"/></c:pieChart></c:plotArea>' +
    '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
    "</c:chart></c:chartSpace>"
  );
}

function anchor(p: Pie, i: number): string {
  // xdr:from/to are 0-based cells
  return (
    "<xdr:twoCellAnchor>" +
    `<xdr:from><xdr:col>${p.at.col - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.at.row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${p.at.col - 1 + p.at.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.at.row - 1 + p.at.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Diagram ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart${i + 1}"/>` +
    "</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>"
  );
}

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DRAWING_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const CHART_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

// the elements a worksheet may hold AFTER its drawing (ECMA-376 CT_Worksheet): the drawing goes before the first of them
const AFTER_DRAWING = ["<legacyDrawing", "<legacyDrawingHF", "<drawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"];

/** Adds the pies to the sheet at `sheetIndex` (1-based, the order ExcelJS wrote the sheets in) of a finished .xlsx. */
export async function addPies(xlsx: Buffer, sheetIndex: number, sheetName: string, pies: Pie[]): Promise<Buffer> {
  if (pies.length === 0) return xlsx;
  const zip = await JSZip.loadAsync(xlsx);
  const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`;
  const sheet = await zip.file(sheetPath)?.async("string");
  if (!sheet) throw new Error(`no ${sheetPath} in the workbook`);
  if (sheet.includes("<drawing ")) throw new Error(`${sheetPath} has a drawing already`);
  const drawingNo = Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f)).length + 1;
  const chartBase = Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f)).length;

  // the sheet: its drawing, by a relationship
  const relsPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`;
  const rels = (await zip.file(relsPath)?.async("string")) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
  const relId = "rIdPieDrawing";
  zip.file(relsPath, rels.replace("</Relationships>", `<Relationship Id="${relId}" Type="${DRAWING_REL}" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`));
  const cut = Math.min(...AFTER_DRAWING.map((t) => sheet.indexOf(t)).filter((i) => i >= 0));
  let withNs = sheet;
  if (!/xmlns:r="/.test(sheet.slice(0, sheet.indexOf(">", sheet.indexOf("<worksheet")))))
    withNs = sheet.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  const shift = withNs.length - sheet.length;
  zip.file(sheetPath, `${withNs.slice(0, cut + shift)}<drawing r:id="${relId}"/>${withNs.slice(cut + shift)}`);

  // the drawing and its charts
  zip.file(
    `xl/drawings/drawing${drawingNo}.xml`,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      pies.map(anchor).join("") +
      "</xdr:wsDr>",
  );
  zip.file(
    `xl/drawings/_rels/drawing${drawingNo}.xml.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">` +
      pies.map((_, i) => `<Relationship Id="rIdChart${i + 1}" Type="${CHART_REL}" Target="../charts/chart${chartBase + i + 1}.xml"/>`).join("") +
      "</Relationships>",
  );
  pies.forEach((p, i) => zip.file(`xl/charts/chart${chartBase + i + 1}.xml`, chartXml(sheetName, p)));

  const types = await zip.file("[Content_Types].xml")!.async("string");
  const overrides =
    `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
    pies.map((_, i) => `<Override PartName="/xl/charts/chart${chartBase + i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("");
  zip.file("[Content_Types].xml", types.replace("</Types>", `${overrides}</Types>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
