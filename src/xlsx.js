import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { sha256 } from "./result.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  trimValues: false,
  removeNSPrefix: true,
});

const REQUIRED_PARTS = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"];
const ERROR_VALUES = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"]);
const VOLATILE_FUNCTIONS = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|OFFSET|INDIRECT|CELL|INFO)\s*\(/i;
const EXTERNAL_FORMULA = /\[[^\]]+\]|https?:\/\/|\\\\/i;

function arrayify(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && "#text" in value) return String(value["#text"]);
  if (typeof value === "object") return null;
  return String(value);
}

function partText(parts, name) {
  const bytes = parts[name];
  if (!bytes) return null;
  return strFromU8(bytes);
}

function parseXml(parts, name, diagnostics) {
  const raw = partText(parts, name);
  if (raw === null) return null;
  try {
    const validation = XMLValidator.validate(raw);
    if (validation !== true) {
      const detail = validation?.err?.msg || "invalid XML";
      diagnostics.push({
        code: "invalid_xml",
        severity: "error",
        material: true,
        part: name,
        message: `Could not parse ${name}: ${detail}`,
      });
      return null;
    }
    return parser.parse(raw);
  } catch (error) {
    diagnostics.push({
      code: "invalid_xml",
      severity: "error",
      material: true,
      part: name,
      message: `Could not parse ${name}: ${error.message}`,
    });
    return null;
  }
}

function relationshipMap(document) {
  const relationships = arrayify(document?.Relationships?.Relationship);
  return new Map(relationships.map((rel) => [rel?.["@_Id"], rel]));
}

function normalizeTarget(base, target) {
  const rawTarget = target || "";
  const normalized = rawTarget.startsWith("/")
    ? path.posix.normalize(rawTarget.replace(/^\/+/, ""))
    : path.posix.normalize(path.posix.join(base, rawTarget));
  return normalized.replace(/^\.\//, "");
}

function parseSharedStrings(parts, diagnostics) {
  const document = parseXml(parts, "xl/sharedStrings.xml", diagnostics);
  if (!document) return [];
  return arrayify(document?.sst?.si).map((item) => {
    if (item?.t !== undefined) return text(item.t) ?? "";
    return arrayify(item?.r).map((run) => text(run?.t) ?? "").join("");
  });
}

function decodeCellValue(cell, sharedStrings) {
  const type = cell?.["@_t"] || null;
  const raw = text(cell?.v);
  if (type === "s") return { value: sharedStrings[Number(raw)] ?? null, valueType: "string" };
  if (type === "inlineStr") {
    const inline = cell?.is?.t !== undefined
      ? text(cell.is.t)
      : arrayify(cell?.is?.r).map((run) => text(run?.t) ?? "").join("");
    return { value: inline ?? "", valueType: "string" };
  }
  if (type === "str") return { value: raw, valueType: "string" };
  if (type === "b") return { value: raw === "1", valueType: "boolean" };
  if (type === "e" || ERROR_VALUES.has(raw)) return { value: raw, valueType: "error" };
  if (raw === null || raw === "") return { value: null, valueType: "blank" };
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return { value: numeric, valueType: "number" };
  return { value: raw, valueType: type || "unknown" };
}

function worksheetFeatures(document, partName, parts) {
  const worksheet = document?.worksheet || {};
  const drawingRel = worksheet?.drawing?.["@_r:id"] || worksheet?.drawing?.["@_id"] || null;
  const tablePartCount = Number(worksheet?.tableParts?.["@_count"] || arrayify(worksheet?.tableParts?.tablePart).length || 0);
  const headerFooter = worksheet?.headerFooter || {};
  const headerFooterCount = ["oddHeader", "oddFooter", "evenHeader", "evenFooter", "firstHeader", "firstFooter"]
    .filter((key) => (text(headerFooter?.[key]) || "").trim().length > 0).length;
  const rows = arrayify(worksheet?.sheetData?.row);
  const maximumRowOutlineLevel = rows.reduce((maximum, row) => Math.max(maximum, Number(row?.["@_outlineLevel"] || 0)), 0);
  const panes = arrayify(worksheet?.sheetViews?.sheetView).flatMap((sheetView) => arrayify(sheetView?.pane));
  return {
    autoFilter: worksheet?.autoFilter?.["@_ref"] || null,
    mergedCellCount: Number(worksheet?.mergeCells?.["@_count"] || arrayify(worksheet?.mergeCells?.mergeCell).length || 0),
    conditionalFormattingCount: arrayify(worksheet?.conditionalFormatting).length,
    dataValidationCount: Number(worksheet?.dataValidations?.["@_count"] || arrayify(worksheet?.dataValidations?.dataValidation).length || 0),
    headerFooterCount,
    frozenPaneCount: panes.filter((pane) => ["frozen", "frozenSplit"].includes(pane?.["@_state"])).length,
    landscapeOrientationPresent: worksheet?.pageSetup?.["@_orientation"] === "landscape",
    ignoredErrorCount: arrayify(worksheet?.ignoredErrors?.ignoredError).length,
    rowBreakCount: Number(worksheet?.rowBreaks?.["@_count"] || arrayify(worksheet?.rowBreaks?.brk).length || 0),
    columnBreakCount: Number(worksheet?.colBreaks?.["@_count"] || arrayify(worksheet?.colBreaks?.brk).length || 0),
    maximumRowOutlineLevel,
    sheetProtectionPresent: worksheet?.sheetProtection !== undefined,
    tablePartCount,
    drawingRelationship: drawingRel,
    hasDrawing: Boolean(drawingRel),
    hyperlinkCount: arrayify(worksheet?.hyperlinks?.hyperlink).length,
    hasHyperlinks: arrayify(worksheet?.hyperlinks?.hyperlink).length > 0,
    part: partName,
  };
}

function parseCells(document, sheetName, sharedStrings, diagnostics, partName) {
  const rows = arrayify(document?.worksheet?.sheetData?.row);
  const cells = {};
  for (const row of rows) {
    for (const cell of arrayify(row?.c)) {
      const ref = cell?.["@_r"];
      if (!ref || !/^\$?[A-Z]{1,3}\$?[1-9][0-9]*$/i.test(ref)) {
        diagnostics.push({
          code: "invalid_cell_reference",
          severity: "error",
          material: true,
          part: partName,
          cell: ref || null,
          message: `Invalid or missing cell reference in ${sheetName}`,
        });
        continue;
      }
      const formulaText = text(cell?.f);
      const decoded = decodeCellValue(cell, sharedStrings);
      if (decoded.valueType === "n") {
        diagnostics.push({
          code: "invalid_numeric_lexical_value",
          severity: "error",
          material: true,
          part: partName,
          cell: ref,
          value: decoded.value,
          message: `Cell ${sheetName}!${ref} declares a numeric value that is not a valid number`,
        });
      }
      cells[ref.replaceAll("$", "").toUpperCase()] = {
        formula: formulaText,
        cachedValue: decoded.value,
        valueType: decoded.valueType,
        styleIndex: cell?.["@_s"] === undefined ? null : Number(cell["@_s"]),
        volatile: Boolean(formulaText && VOLATILE_FUNCTIONS.test(formulaText)),
        external: Boolean(formulaText && EXTERNAL_FORMULA.test(formulaText)),
      };
    }
  }
  return cells;
}

function inventoryNamedObjects(workbookDocument, parts) {
  const definedNames = arrayify(workbookDocument?.workbook?.definedNames?.definedName).map((entry) => ({
    type: "definedName",
    name: entry?.["@_name"] || null,
    localSheetId: entry?.["@_localSheetId"] === undefined ? null : Number(entry["@_localSheetId"]),
    hidden: entry?.["@_hidden"] === "1",
    formula: text(entry),
  }));
  return definedNames.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function packageFeatures(parts, workbookDocument) {
  const names = Object.keys(parts);
  const workbookProtection = workbookDocument?.workbook?.workbookProtection;
  const protectionEnabled = workbookProtection && ["lockStructure", "lockWindows", "lockRevision"]
    .some((attribute) => ["1", "true", "on"].includes(String(workbookProtection?.[`@_${attribute}`] || "").toLowerCase()));
  return {
    macros: names.some((name) => /vbaProject\.bin$/i.test(name)),
    externalLinks: names.filter((name) => /^xl\/externalLinks\/externalLink\d+\.xml$/.test(name)).length,
    images: names.filter((name) => /^xl\/media\//.test(name)).length,
    charts: names.filter((name) => /\/charts\/chart\d+\.xml$/.test(name)).length,
    tables: names.filter((name) => /^xl\/tables\/table\d+\.xml$/.test(name)).length,
    pivotTables: names.filter((name) => /^xl\/pivotTables\//.test(name)).length,
    comments: names.filter((name) => /^xl\/comments\d+\.xml$/i.test(name)).length,
    customProperties: names.filter((name) => /^docProps\/custom\.xml$/i.test(name)).length,
    workbookProtectionPresent: Boolean(protectionEnabled),
    calculationMode: workbookDocument?.workbook?.calcPr?.["@_calcMode"] || null,
    forceFullCalculation: workbookDocument?.workbook?.calcPr?.["@_forceFullCalc"] || null,
    fullCalculationOnLoad: workbookDocument?.workbook?.calcPr?.["@_fullCalcOnLoad"] || null,
  };
}

function validateRelationships(parts, diagnostics) {
  for (const name of Object.keys(parts).filter((part) => /_rels\/[^/]+\.rels$/.test(part))) {
    const document = parseXml(parts, name, diagnostics);
    if (!document) continue;
    const base = name.replace(/_rels\/[^/]+\.rels$/, "");
    for (const rel of arrayify(document?.Relationships?.Relationship)) {
      if (rel?.["@_TargetMode"] === "External") continue;
      const target = normalizeTarget(base, rel?.["@_Target"]);
      if (!parts[target]) {
        diagnostics.push({
          code: "missing_relationship_target",
          severity: "error",
          material: true,
          part: name,
          relationshipId: rel?.["@_Id"] || null,
          target,
          message: `${name} points to missing part ${target}`,
        });
      }
    }
  }
}

export function inspectXlsxBytes(input, { includeRawParts = false, sourcePath = null } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const diagnostics = [];
  const result = {
    path: sourcePath ? path.resolve(sourcePath) : null,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    package: { validZip: false, requiredPartsPresent: false, partCount: 0, features: {} },
    workbook: { sheets: [], namedObjects: [] },
    diagnostics,
  };

  let parts;
  try {
    parts = unzipSync(new Uint8Array(bytes));
    result.package.validZip = true;
    result.package.partCount = Object.keys(parts).length;
  } catch (error) {
    diagnostics.push({ code: "invalid_zip", severity: "error", material: true, message: `Not a readable XLSX ZIP package: ${error.message}` });
    return result;
  }

  const missingRequired = REQUIRED_PARTS.filter((name) => !parts[name]);
  result.package.requiredPartsPresent = missingRequired.length === 0;
  for (const part of missingRequired) {
    diagnostics.push({ code: "missing_required_part", severity: "error", material: true, part, message: `Missing required XLSX part ${part}` });
  }

  validateRelationships(parts, diagnostics);
  const workbookDocument = parseXml(parts, "xl/workbook.xml", diagnostics);
  const workbookRels = parseXml(parts, "xl/_rels/workbook.xml.rels", diagnostics);
  const rels = relationshipMap(workbookRels);
  const sharedStrings = parseSharedStrings(parts, diagnostics);
  const seenSheetNames = new Set();

  for (const sheetEntry of arrayify(workbookDocument?.workbook?.sheets?.sheet)) {
    const name = sheetEntry?.["@_name"] || null;
    const relId = sheetEntry?.["@_r:id"] || sheetEntry?.["@_id"] || null;
    if (name && seenSheetNames.has(name.toLowerCase())) {
      diagnostics.push({ code: "duplicate_sheet_name", severity: "error", material: true, sheet: name, message: `Duplicate sheet name ${name}` });
    }
    if (name) seenSheetNames.add(name.toLowerCase());
    const relationship = rels.get(relId);
    const partName = relationship ? normalizeTarget("xl", relationship["@_Target"]) : null;
    if (!relationship) {
      diagnostics.push({ code: "missing_sheet_relationship", severity: "error", material: true, sheet: name, relationshipId: relId, message: `Sheet ${name || "(unnamed)"} has no relationship target` });
    }
    const document = partName ? parseXml(parts, partName, diagnostics) : null;
    if (partName && !parts[partName]) {
      diagnostics.push({ code: "missing_worksheet_part", severity: "error", material: true, sheet: name, part: partName, message: `Sheet ${name} points to missing part ${partName}` });
    }
    result.workbook.sheets.push({
      name,
      state: sheetEntry?.["@_state"] || "visible",
      part: partName,
      features: document ? worksheetFeatures(document, partName, parts) : {},
      cells: document ? parseCells(document, name, sharedStrings, diagnostics, partName) : {},
    });
  }

  result.workbook.namedObjects = workbookDocument ? inventoryNamedObjects(workbookDocument, parts) : [];
  result.package.features = packageFeatures(parts, workbookDocument);

  if (result.package.features.macros) {
    diagnostics.push({ code: "macros_present", severity: "warning", material: false, message: "Workbook contains VBA; macro execution is intentionally unavailable" });
  }
  if (result.package.features.externalLinks > 0) {
    diagnostics.push({ code: "external_links_present", severity: "warning", material: false, count: result.package.features.externalLinks, message: "External link values are environment-dependent and ignored by default" });
  }

  const formulaCells = result.workbook.sheets.flatMap((sheet) => Object.entries(sheet.cells).filter(([, cell]) => cell.formula).map(([ref, cell]) => ({ sheet: sheet.name, ref, ...cell })));
  const missingCaches = formulaCells.filter((cell) => cell.cachedValue === null).length;
  if (missingCaches > 0) {
    diagnostics.push({ code: "formula_cache_missing", severity: "warning", material: false, count: missingCaches, message: `${missingCaches} formula cell(s) have no cached value` });
  }

  if (includeRawParts) result.rawParts = parts;
  return result;
}

export async function inspectXlsx(filePath, options = {}) {
  const bytes = await fs.readFile(filePath);
  return inspectXlsxBytes(bytes, { ...options, sourcePath: filePath });
}
