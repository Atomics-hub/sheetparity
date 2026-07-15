import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const root = path.resolve(import.meta.dirname, "..");
const seedPath = path.join(root, "fixtures", "seeds", "adversarial-seed.xlsx");
const corpusDir = path.join(root, "fixtures", "corpus");
await fs.mkdir(corpusDir, { recursive: true });
await fs.rm(path.join(corpusDir, "explore-08-locale-format.xlsx"), { force: true });
const seedBytes = await fs.readFile(seedPath);
const seedParts = unzipSync(new Uint8Array(seedBytes));

function cloneParts() {
  return Object.fromEntries(Object.entries(seedParts).map(([name, bytes]) => [name, new Uint8Array(bytes)]));
}

function xml(parts, name) {
  return strFromU8(parts[name]);
}

function setXml(parts, name, value) {
  parts[name] = strToU8(value);
}

function replaceCellFormula(sheetXml, ref, formula, value) {
  const pattern = new RegExp(`(<x:c[^>]*\\br="${ref}"[^>]*>)([\\s\\S]*?)(</x:c>)`);
  return sheetXml.replace(pattern, (_, open, inner, close) => {
    let next = inner.replace(/<x:f(?:\s[^>]*)?>[\s\S]*?<\/x:f>/, `<x:f>${formula}</x:f>`);
    if (!/<x:f/.test(next)) next = `<x:f>${formula}</x:f>${next}`;
    next = next.replace(/<x:v>[\s\S]*?<\/x:v>/, `<x:v>${value}</x:v>`);
    return `${open}${next}${close}`;
  });
}

function replaceCellValue(sheetXml, ref, value) {
  const pattern = new RegExp(`(<x:c[^>]*\\br="${ref}"[^>]*>[\\s\\S]*?<x:v>)([\\s\\S]*?)(</x:v>[\\s\\S]*?</x:c>)`);
  const next = sheetXml.replace(pattern, `$1${value}$3`);
  if (next === sheetXml) throw new Error(`Could not replace cached value in ${ref}`);
  return next;
}

async function writeZip(name, mutate) {
  const parts = cloneParts();
  await mutate(parts);
  await fs.writeFile(path.join(corpusDir, name), Buffer.from(zipSync(parts, { level: 9 })));
}

async function writeZipFrom(name, sourcePath, mutate) {
  const parts = unzipSync(new Uint8Array(await fs.readFile(sourcePath)));
  await mutate(parts);
  await fs.writeFile(path.join(corpusDir, name), Buffer.from(zipSync(parts, { level: 9 })));
}

const bad = [
  { file: "bad-01-not-a-zip.xlsx", defect: "Non-ZIP bytes with an XLSX extension", packageWellFormed: false, write: async () => fs.writeFile(path.join(corpusDir, "bad-01-not-a-zip.xlsx"), "this is not an XLSX package\n") },
  { file: "bad-02-truncated-zip.xlsx", defect: "Truncated ZIP central directory", packageWellFormed: false, write: async () => fs.writeFile(path.join(corpusDir, "bad-02-truncated-zip.xlsx"), seedBytes.subarray(0, Math.floor(seedBytes.length / 2))) },
  { file: "bad-03-missing-content-types.xlsx", defect: "Missing [Content_Types].xml", packageWellFormed: false, mutate: (parts) => { delete parts["[Content_Types].xml"]; } },
  { file: "bad-04-missing-workbook.xlsx", defect: "Missing xl/workbook.xml", packageWellFormed: false, mutate: (parts) => { delete parts["xl/workbook.xml"]; } },
  { file: "bad-05-missing-workbook-rels.xlsx", defect: "Missing workbook relationships", packageWellFormed: false, mutate: (parts) => { delete parts["xl/_rels/workbook.xml.rels"]; } },
  { file: "bad-06-missing-worksheet.xlsx", defect: "Workbook points to a missing worksheet part", packageWellFormed: false, mutate: (parts) => { delete parts["xl/worksheets/sheet1.xml"]; } },
  { file: "bad-07-missing-styles.xlsx", defect: "Workbook relationship points to missing styles", packageWellFormed: false, mutate: (parts) => { delete parts["xl/styles.xml"]; } },
  { file: "bad-08-missing-theme.xlsx", defect: "Workbook relationship points to missing theme", packageWellFormed: false, mutate: (parts) => { delete parts["xl/theme/theme1.xml"]; } },
  { file: "bad-09-malformed-workbook-xml.xlsx", defect: "Malformed workbook XML", packageWellFormed: false, mutate: (parts) => setXml(parts, "xl/workbook.xml", xml(parts, "xl/workbook.xml").replace("</x:workbook>", "")) },
  { file: "bad-10-malformed-worksheet-xml.xlsx", defect: "Malformed worksheet XML", packageWellFormed: false, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", xml(parts, "xl/worksheets/sheet1.xml").replace("</x:sheetData>", "")) },
  { file: "bad-11-broken-relationship-target.xlsx", defect: "Worksheet relationship target does not exist", packageWellFormed: false, mutate: (parts) => setXml(parts, "xl/_rels/workbook.xml.rels", xml(parts, "xl/_rels/workbook.xml.rels").replace("/xl/worksheets/sheet1.xml", "/xl/worksheets/missing.xml")) },
  { file: "bad-12-missing-sheet-relationship.xlsx", defect: "Sheet uses an unknown relationship id", packageWellFormed: false, mutate: (parts) => setXml(parts, "xl/workbook.xml", xml(parts, "xl/workbook.xml").replace(/r:id="[^"]+"/, 'r:id="missingRel"')) },
  { file: "bad-13-invalid-cell-reference.xlsx", defect: "Cell has an invalid A1 reference", packageWellFormed: false, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", xml(parts, "xl/worksheets/sheet1.xml").replace('r="D4"', 'r="BAD!"')) },
  { file: "bad-14-duplicate-sheet-name.xlsx", defect: "Workbook contains duplicate case-insensitive sheet names", packageWellFormed: false, mutate: (parts) => setXml(parts, "xl/workbook.xml", xml(parts, "xl/workbook.xml").replace("</x:sheets>", '<x:sheet name="report" sheetId="2" r:id="R47a2569f9f12411b" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets>')) },
  { file: "bad-15-stale-cache-d4.xlsx", defect: "Formula cache says 999 while B4*C4 recalculates to 75", packageWellFormed: true, semanticDivergence: true, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "D4", "999")) },
  { file: "bad-16-stale-cache-d5.xlsx", defect: "Formula cache says -123 while B5*C5 recalculates to 87", packageWellFormed: true, semanticDivergence: true, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "D5", "-123")) },
  { file: "bad-17-stale-cache-d6.xlsx", defect: "Formula cache says 0 while B6*C6 recalculates to -9", packageWellFormed: true, semanticDivergence: true, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "D6", "0")) },
  { file: "bad-18-stale-cache-d7.xlsx", defect: "Formula cache says 1 while SUM(D4:D6) recalculates to 153", packageWellFormed: true, semanticDivergence: true, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "D7", "1")) },
  { file: "bad-19-stale-cache-g4.xlsx", defect: "Formula cache says 240 while F4*2 recalculates to 24", packageWellFormed: true, semanticDivergence: true, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "G4", "240")) },
  { file: "bad-20-stale-cache-h4.xlsx", defect: "Formula cache says 0 while G4+1 recalculates to 25", packageWellFormed: true, semanticDivergence: true, mutate: (parts) => setXml(parts, "xl/worksheets/sheet1.xml", replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "H4", "0")) },
];

for (const fixture of bad) {
  if (fixture.write) await fixture.write();
  else await writeZip(fixture.file, fixture.mutate);
}

await writeZip("explore-04-external-link-policy.xlsx", (parts) => {
  setXml(parts, "xl/worksheets/sheet1.xml", replaceCellFormula(xml(parts, "xl/worksheets/sheet1.xml"), "H4", "[1]Sheet1!A1", "25"));
});
await writeZip("explore-05-volatile-policy.xlsx", (parts) => {
  setXml(parts, "xl/worksheets/sheet1.xml", replaceCellFormula(xml(parts, "xl/worksheets/sheet1.xml"), "H4", "NOW()", "46217"));
});
await writeZip("explore-06-defined-name.xlsx", (parts) => {
  setXml(parts, "xl/workbook.xml", xml(parts, "xl/workbook.xml").replace("</x:workbook>", '<x:definedNames><x:definedName name="Output">Report!$D$7</x:definedName></x:definedNames></x:workbook>'));
});
await writeZip("explore-07-array-formula.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace("<x:f>F4*2</x:f>", '<x:f t="array" ref="G4">F4*2</x:f>');
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});
await writeZip("explore-08-phpspreadsheet-1281-decimal-comma.xlsx", (parts) => {
  let sheet = replaceCellValue(xml(parts, "xl/worksheets/sheet1.xml"), "C4", "1.1.0");
  sheet = replaceCellValue(sheet, "D4", "33");
  sheet = replaceCellValue(sheet, "D7", "111");
  if (!sheet.includes('<x:v>1.1.0</x:v>')) throw new Error("Could not author PhpSpreadsheet #1281 decimal-comma reproducer");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-11-exceljs-1325-header-footer.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(
    "</x:worksheet>",
    '<x:headerFooter differentFirst="1" differentOddEven="1"><x:oddHeader>&amp;LSheetParity&amp;RPage &amp;P of &amp;N</x:oddHeader><x:oddFooter>&amp;CConfidential</x:oddFooter><x:firstHeader>&amp;CGenerated workbook</x:firstHeader><x:firstFooter>&amp;CFirst page</x:firstFooter></x:headerFooter></x:worksheet>',
  );
  if (!sheet.includes("<x:headerFooter")) throw new Error("Could not author ExcelJS #1325 header/footer fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-12-exceljs-685-sheet-protection.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(
    "</x:sheetData>",
    '</x:sheetData><x:sheetProtection sheet="1" objects="1" scenarios="1" selectLockedCells="1" selectUnlockedCells="0" />',
  );
  if (!sheet.includes("<x:sheetProtection")) throw new Error("Could not author ExcelJS #685 sheet-protection fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-13-exceljs-2069-long-data-validation.xlsx", (parts) => {
  const choices = Array.from({ length: 150 }, (_, index) => `choice-${String(index + 1).padStart(3, "0")}`).join(",");
  const formula = `&quot;${choices}&quot;`;
  if (formula.length <= 1024) throw new Error("Long data-validation fixture must exceed the reported 1024-character edge");
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(
    "<x:pageMargins",
    `<x:dataValidations count="1"><x:dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="B4"><x:formula1>${formula}</x:formula1></x:dataValidation></x:dataValidations><x:pageMargins`,
  );
  if (!sheet.includes("<x:dataValidations")) throw new Error("Could not author ExcelJS #2069 long-data-validation fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-14-synthetic-page-breaks.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(
    "</x:worksheet>",
    '<x:rowBreaks count="1" manualBreakCount="1"><x:brk id="5" min="0" max="16383" man="1" /></x:rowBreaks><x:colBreaks count="1" manualBreakCount="1"><x:brk id="2" min="0" max="1048575" man="1" /></x:colBreaks></x:worksheet>',
  );
  if (!sheet.includes("<x:rowBreaks") || !sheet.includes("<x:colBreaks")) throw new Error("Could not author page-break fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-15-synthetic-ignored-errors.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(
    "</x:worksheet>",
    '<x:ignoredErrors><x:ignoredError sqref="A4:A6" numberStoredAsText="1" /></x:ignoredErrors></x:worksheet>',
  );
  if (!sheet.includes("<x:ignoredErrors")) throw new Error("Could not author ignored-errors fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-16-synthetic-row-outline.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace('<x:row r="4">', '<x:row r="4" outlineLevel="1" hidden="1">');
  if (!sheet.includes('outlineLevel="1"')) throw new Error("Could not author row-outline fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZipFrom("explore-17-exceljs-very-hidden-sheet.xlsx", path.join(corpusDir, "good-18-multiple-sheets.xlsx"), (parts) => {
  const workbook = xml(parts, "xl/workbook.xml").replace('name="Inputs" sheetId="2"', 'name="Inputs" sheetId="2" state="veryHidden"');
  if (!workbook.includes('state="veryHidden"')) throw new Error("Could not author very-hidden sheet fixture");
  setXml(parts, "xl/workbook.xml", workbook);
});

await writeZip("explore-18-openxml-workbook-protection.xlsx", (parts) => {
  const workbook = xml(parts, "xl/workbook.xml").replace("<x:sheets>", '<x:workbookProtection lockStructure="1" lockWindows="0" /><x:sheets>');
  if (!workbook.includes("<x:workbookProtection")) throw new Error("Could not author workbook-protection fixture");
  setXml(parts, "xl/workbook.xml", workbook);
});

await writeZip("explore-19-openxml-custom-property.xlsx", (parts) => {
  setXml(parts, "docProps/custom.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="SheetParityPolicy"><vt:lpwstr>strict</vt:lpwstr></property></Properties>');
  setXml(parts, "_rels/.rels", xml(parts, "_rels/.rels").replace("</Relationships>", '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="/docProps/custom.xml" Id="rIdSheetParityCustom" /></Relationships>'));
  setXml(parts, "[Content_Types].xml", xml(parts, "[Content_Types].xml").replace("</Types>", '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml" /></Types>'));
});

await writeZip("explore-20-exceljs-print-area.xlsx", (parts) => {
  const workbook = xml(parts, "xl/workbook.xml").replace("</x:workbook>", '<x:definedNames><x:definedName name="_xlnm.Print_Area" localSheetId="0">Report!$A$1:$D$7</x:definedName></x:definedNames></x:workbook>');
  if (!workbook.includes("_xlnm.Print_Area")) throw new Error("Could not author print-area fixture");
  setXml(parts, "xl/workbook.xml", workbook);
});

await writeZip("explore-21-exceljs-landscape-page-setup.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(/(<x:pageMargins[^>]*\/>)/, '$1<x:pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0" />');
  if (!sheet.includes('orientation="landscape"')) throw new Error("Could not author landscape page-setup fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-22-exceljs-frozen-pane.xlsx", (parts) => {
  const sheet = xml(parts, "xl/worksheets/sheet1.xml").replace(
    '<x:sheetView showGridLines="0" workbookViewId="0" />',
    '<x:sheetView showGridLines="0" workbookViewId="0"><x:pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen" /><x:selection pane="bottomLeft" activeCell="A4" sqref="A4" /></x:sheetView>',
  );
  if (!sheet.includes('state="frozen"')) throw new Error("Could not author frozen-pane fixture");
  setXml(parts, "xl/worksheets/sheet1.xml", sheet);
});

await writeZip("explore-23-exceljs-legacy-note.xlsx", (parts) => {
  setXml(parts, "xl/comments1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>SheetParity</author></authors><commentList><comment ref="A4" authorId="0"><text><t>Review north region</t></text></comment></commentList></comments>');
  setXml(parts, "xl/drawings/vmlDrawing1.vml", '<?xml version="1.0" encoding="UTF-8"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1" /></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter" /><v:path gradientshapeok="t" o:connecttype="rect" /></v:shapetype><v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:5pt;width:120pt;height:60pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:textbox><div /></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells /><x:SizeWithCells /><x:Anchor>1, 15, 0, 2, 3, 15, 4, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>3</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>');
  setXml(parts, "xl/worksheets/_rels/sheet1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSheetParityComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml" /><Relationship Id="rIdSheetParityVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml" /></Relationships>');
  setXml(parts, "xl/worksheets/sheet1.xml", xml(parts, "xl/worksheets/sheet1.xml").replace("</x:worksheet>", '<x:legacyDrawing r:id="rIdSheetParityVml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:worksheet>'));
  setXml(parts, "[Content_Types].xml", xml(parts, "[Content_Types].xml").replace("</Types>", '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing" /><Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml" /></Types>'));
});

await writeZip("explore-24-excel-aggregate-formula.xlsx", (parts) => {
  setXml(parts, "xl/worksheets/sheet1.xml", replaceCellFormula(xml(parts, "xl/worksheets/sheet1.xml"), "G4", "AGGREGATE(9,6,F4:F4)", "12"));
});

await writeZip("explore-25-excel-filterxml-formula.xlsx", (parts) => {
  setXml(parts, "xl/worksheets/sheet1.xml", replaceCellFormula(xml(parts, "xl/worksheets/sheet1.xml"), "G4", 'FILTERXML(&quot;&lt;a>&lt;b>7&lt;/b>&lt;/a>&quot;,&quot;//b&quot;)', "7"));
});

await writeZip("explore-26-excel-rri-formula.xlsx", (parts) => {
  setXml(parts, "xl/worksheets/sheet1.xml", replaceCellFormula(xml(parts, "xl/worksheets/sheet1.xml"), "G4", "RRI(4,100,200)", "0.189207115002721"));
});

await writeZip("explore-27-excel-pduration-formula.xlsx", (parts) => {
  setXml(parts, "xl/worksheets/sheet1.xml", replaceCellFormula(xml(parts, "xl/worksheets/sheet1.xml"), "G4", "PDURATION(0.1,100,200)", "7.27254089734171"));
});

await writeZip("explore-28-openxml-manual-calculation.xlsx", (parts) => {
  const workbook = xml(parts, "xl/workbook.xml").replace("</x:workbook>", '<x:calcPr calcMode="manual" forceFullCalc="0" fullCalcOnLoad="0" /></x:workbook>');
  if (!workbook.includes('calcMode="manual"')) throw new Error("Could not author manual-calculation fixture");
  setXml(parts, "xl/workbook.xml", workbook);
});

const issueProvenance = {
  "explore-01-exceljs-2778-autofilter.xlsx": ["https://github.com/exceljs/exceljs/issues/2778"],
  "explore-02-exceljs-2896-image-anchor.xlsx": ["https://github.com/exceljs/exceljs/issues/2896"],
  "explore-03-npoi-1801-open-control.xlsx": ["https://github.com/nissl-lab/npoi/issues/1801"],
  "explore-08-phpspreadsheet-1281-decimal-comma.xlsx": ["https://github.com/PHPOffice/PhpSpreadsheet/issues/1281"],
  "explore-11-exceljs-1325-header-footer.xlsx": ["https://github.com/exceljs/exceljs/issues/1325"],
  "explore-12-exceljs-685-sheet-protection.xlsx": ["https://github.com/exceljs/exceljs/issues/685"],
  "explore-13-exceljs-2069-long-data-validation.xlsx": ["https://github.com/exceljs/exceljs/discussions/2069"],
  "explore-17-exceljs-very-hidden-sheet.xlsx": ["https://github.com/exceljs/exceljs#worksheet-state"],
  "explore-18-openxml-workbook-protection.xlsx": ["https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.workbook.workbookprotection"],
  "explore-19-openxml-custom-property.xlsx": ["https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-workbooks#access-document-properties"],
  "explore-20-exceljs-print-area.xlsx": ["https://github.com/exceljs/exceljs#page-setup"],
  "explore-21-exceljs-landscape-page-setup.xlsx": ["https://github.com/exceljs/exceljs#page-setup"],
  "explore-22-exceljs-frozen-pane.xlsx": ["https://github.com/exceljs/exceljs#frozen-views"],
  "explore-23-exceljs-legacy-note.xlsx": ["https://github.com/exceljs/exceljs#cell-comments"],
  "explore-24-excel-aggregate-formula.xlsx": ["https://support.microsoft.com/en-us/excel/aggregate-function"],
  "explore-25-excel-filterxml-formula.xlsx": ["https://support.microsoft.com/en-us/excel/filterxml-function"],
  "explore-26-excel-rri-formula.xlsx": ["https://support.microsoft.com/en-us/excel/excel-functions-alphabetical"],
  "explore-27-excel-pduration-formula.xlsx": ["https://support.microsoft.com/en-us/excel/excel-functions-alphabetical"],
  "explore-28-openxml-manual-calculation.xlsx": ["synthetic: authored for SheetParity"],
};

const exploratoryDescriptions = new Map([
  ["explore-08-phpspreadsheet-1281-decimal-comma.xlsx", "Public issue-derived decimal-comma corruption: numeric 1.1 serialized as 1.1.0; report says LibreOffice repairs it while Google Sheets silently drops it"],
  ["explore-11-exceljs-1325-header-footer.xlsx", "Public issue-derived first/odd header and footer preservation edge"],
  ["explore-12-exceljs-685-sheet-protection.xlsx", "Public issue-derived worksheet protection preservation edge"],
  ["explore-13-exceljs-2069-long-data-validation.xlsx", "Public discussion-derived inline list data validation exceeding the reported 1024-character edge"],
  ["explore-14-synthetic-page-breaks.xlsx", "Synthetic manual row and column page-break preservation edge"],
  ["explore-15-synthetic-ignored-errors.xlsx", "Synthetic ignored-error metadata preservation edge"],
  ["explore-16-synthetic-row-outline.xlsx", "Synthetic hidden outlined-row preservation edge"],
  ["explore-17-exceljs-very-hidden-sheet.xlsx", "ExcelJS-documented very-hidden worksheet state preservation edge"],
  ["explore-18-openxml-workbook-protection.xlsx", "Open XML workbook-structure protection preservation edge"],
  ["explore-19-openxml-custom-property.xlsx", "Open XML custom document-property preservation edge"],
  ["explore-20-exceljs-print-area.xlsx", "ExcelJS-documented print-area defined-name preservation edge"],
  ["explore-21-exceljs-landscape-page-setup.xlsx", "ExcelJS-documented landscape page-setup preservation edge"],
  ["explore-22-exceljs-frozen-pane.xlsx", "ExcelJS-documented frozen-pane preservation edge"],
  ["explore-23-exceljs-legacy-note.xlsx", "ExcelJS-documented legacy cell-note preservation edge"],
  ["explore-24-excel-aggregate-formula.xlsx", "Microsoft-documented AGGREGATE formula compatibility edge"],
  ["explore-25-excel-filterxml-formula.xlsx", "Microsoft-documented FILTERXML formula compatibility edge"],
  ["explore-26-excel-rri-formula.xlsx", "Microsoft-documented RRI formula compatibility edge"],
  ["explore-27-excel-pduration-formula.xlsx", "Microsoft-documented PDURATION formula compatibility edge"],
  ["explore-28-openxml-manual-calculation.xlsx", "Synthetic manual-calculation-mode preservation edge"],
]);
const exploratoryPackageWellFormed = new Map([
  ["explore-08-phpspreadsheet-1281-decimal-comma.xlsx", false],
]);
const followupFixtures = new Set([
  "explore-11-exceljs-1325-header-footer.xlsx",
  "explore-12-exceljs-685-sheet-protection.xlsx",
  "explore-13-exceljs-2069-long-data-validation.xlsx",
  "explore-14-synthetic-page-breaks.xlsx",
  "explore-15-synthetic-ignored-errors.xlsx",
  "explore-16-synthetic-row-outline.xlsx",
]);
const roundThreeFixtures = new Set([
  "explore-17-exceljs-very-hidden-sheet.xlsx",
  "explore-18-openxml-workbook-protection.xlsx",
  "explore-19-openxml-custom-property.xlsx",
  "explore-20-exceljs-print-area.xlsx",
  "explore-21-exceljs-landscape-page-setup.xlsx",
  "explore-22-exceljs-frozen-pane.xlsx",
  "explore-23-exceljs-legacy-note.xlsx",
  "explore-24-excel-aggregate-formula.xlsx",
  "explore-25-excel-filterxml-formula.xlsx",
  "explore-26-excel-rri-formula.xlsx",
  "explore-27-excel-pduration-formula.xlsx",
  "explore-28-openxml-manual-calculation.xlsx",
]);

const files = (await fs.readdir(corpusDir)).filter((file) => file.endsWith(".xlsx")).sort();
const goodDescriptions = new Map([
  ["good-01-basic-arithmetic.xlsx", "Simple multiplication and aggregation"],
  ["good-03-dates.xlsx", "Typed dates with explicit invariant formats"],
  ["good-10-conditional-format.xlsx", "Negative-value conditional formatting"],
  ["good-11-table.xlsx", "Named structured table"],
  ["good-19-chart.xlsx", "Embedded chart with worksheet-backed data"],
  ["good-20-image.xlsx", "Embedded raster drawing"],
]);
const manifest = [];
for (const file of files) {
  const bytes = await fs.readFile(path.join(corpusDir, file));
  const badMeta = bad.find((item) => item.file === file);
  const classification = file.startsWith("good-") ? "known-good" : file.startsWith("bad-") ? "known-bad" : "exploratory";
  manifest.push({
    id: file.replace(/\.xlsx$/, ""),
    file: `corpus/${file}`,
    classification,
    expectedMaterialFailure: classification === "known-bad",
    packageWellFormed: badMeta ? badMeta.packageWellFormed : (exploratoryPackageWellFormed.get(file) ?? true),
    semanticDivergence: Boolean(badMeta?.semanticDivergence),
    description: badMeta?.defect || goodDescriptions.get(file) || exploratoryDescriptions.get(file) || "Synthetic coverage fixture",
    provenance: issueProvenance[file] || ["synthetic: authored for SheetParity"],
    publicSilentValueCandidate: file === "explore-08-phpspreadsheet-1281-decimal-comma.xlsx",
    publicSilentValueFixture: false,
    license: "CC0-1.0",
    copiedThirdPartyBytes: false,
    ...(followupFixtures.has(file) ? { prospectiveRound: "followup-2026-07-15-round-2" } : {}),
    ...(roundThreeFixtures.has(file) ? { prospectiveRound: "followup-2026-07-15-round-3" } : {}),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
  });
}
await fs.writeFile(path.join(root, "fixtures", "manifest.json"), `${JSON.stringify({ schemaVersion: 1, fixtureCount: manifest.length, fixtures: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ fixtureCount: manifest.length, knownGood: manifest.filter((item) => item.classification === "known-good").length, knownBad: manifest.filter((item) => item.classification === "known-bad").length, exploratory: manifest.filter((item) => item.classification === "exploratory").length, semanticDivergence: manifest.filter((item) => item.semanticDivergence).length }, null, 2));
