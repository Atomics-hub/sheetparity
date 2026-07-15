import path from "node:path";
import fs from "node:fs/promises";
import { inspectXlsx } from "./xlsx.js";
import { compareSnapshots } from "./compare.js";
import { attachFingerprint, DEFAULT_POLICY, RESULT_SCHEMA_VERSION } from "./result.js";
import { libreOfficeAdapter } from "./adapters/libreoffice.js";
import { googleSheetsAdapter } from "./adapters/google-sheets.js";
import { unavailableAdapter } from "./adapters/unavailable.js";

const ALIASES = new Map([
  ["google", "google-sheets"],
  ["sheets", "google-sheets"],
  ["lo", "libreoffice"],
  ["desktop-excel", "excel-desktop"],
]);

export function normalizeMatrix(matrix) {
  const values = Array.isArray(matrix) ? matrix : String(matrix || "libreoffice").split(",");
  const normalized = values.map((value) => value.trim().toLowerCase()).filter(Boolean).map((value) => ALIASES.get(value) || value);
  if (normalized.includes("excel")) {
    throw new Error("'excel' is ambiguous. Use 'excel-web' or 'excel-desktop'; SheetParity never labels Excel Web as desktop Excel.");
  }
  return [...new Set(normalized)];
}

function adapterFor(id, options) {
  if (id === "libreoffice") return libreOfficeAdapter(options);
  if (id === "google-sheets") return googleSheetsAdapter(options);
  return unavailableAdapter(id);
}

function summaryFor(source, engines, comparisons, engineComparisons) {
  const sourceMaterialErrors = source.diagnostics.filter((item) => item.material && item.severity === "error").length;
  const unavailableEngines = engines.filter((engine) => engine.status === "unavailable").length;
  const engineErrors = engines.filter((engine) => engine.status === "error" || engine.open?.outcome === "rejected").length;
  const materialDifferences = comparisons.reduce((sum, comparison) => sum + comparison.materialDifferenceCount, 0);
  const engineMaterialDifferences = engineComparisons.reduce((sum, comparison) => sum + comparison.materialDifferenceCount, 0);
  let status = "pass";
  if (sourceMaterialErrors > 0 || engineErrors > 0 || materialDifferences > 0 || engineMaterialDifferences > 0) status = "fail";
  else if (unavailableEngines > 0) status = "incomplete";
  return {
    status,
    sourceMaterialErrors,
    requestedEngineCount: engines.length,
    availableEngineCount: engines.length - unavailableEngines,
    unavailableEngineCount: unavailableEngines,
    engineErrorCount: engineErrors,
    materialDifferenceCount: materialDifferences,
    engineMaterialDifferenceCount: engineMaterialDifferences,
  };
}

export async function testWorkbook(filePath, options = {}) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${absolutePath}`);
  if (path.extname(absolutePath).toLowerCase() !== ".xlsx") throw new Error("SheetParity's initial scope is XLSX only");

  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const source = await inspectXlsx(absolutePath);
  const requested = normalizeMatrix(options.matrix);
  const engines = [];
  const comparisons = [];
  for (const id of requested) {
    const adapter = typeof options.adapterFactory === "function" ? options.adapterFactory(id, options) : adapterFor(id, options);
    if (!adapter) throw new Error(`Unknown engine '${id}'. Supported adapters: libreoffice, excel-web, google-sheets, onlyoffice, excel-desktop`);
    const engine = await adapter.run(absolutePath);
    engines.push(engine);
    if (engine.status === "available") {
      comparisons.push({ engineId: id, engineVersion: engine.version, ...compareSnapshots(source, engine, policy) });
    }
  }

  const engineComparisons = [];
  const availableEngines = engines.filter((engine) => engine.status === "available");
  for (let leftIndex = 0; leftIndex < availableEngines.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < availableEngines.length; rightIndex += 1) {
      const left = availableEngines[leftIndex];
      const right = availableEngines[rightIndex];
      engineComparisons.push({
        leftEngineId: left.id,
        leftEngineVersion: left.version,
        rightEngineId: right.id,
        rightEngineVersion: right.version,
        ...compareSnapshots(left, right, policy, { symmetric: true, referenceSnapshot: source }),
      });
    }
  }

  const result = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      fileName: path.basename(absolutePath),
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
      package: source.package,
      workbook: source.workbook,
      diagnostics: source.diagnostics,
    },
    requestedMatrix: requested,
    engines,
    comparisons,
    engineComparisons,
    policy,
    summary: summaryFor(source, engines, comparisons, engineComparisons),
  };
  return attachFingerprint(result);
}
