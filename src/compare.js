import { DEFAULT_POLICY } from "./result.js";

function cellMap(snapshot) {
  const map = new Map();
  for (const sheet of snapshot?.workbook?.sheets || []) {
    for (const [ref, cell] of Object.entries(sheet.cells || {})) {
      map.set(`${sheet.name}!${ref}`, cell);
    }
  }
  return map;
}

function namedObjectKey(object) {
  return JSON.stringify([object.type, object.name || null, object.part || null, object.localSheetId ?? null]);
}

function equalValue(left, right, policy) {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") {
    const absolute = Math.abs(left - right);
    if (absolute <= policy.numericAbsoluteTolerance) return true;
    const scale = Math.max(Math.abs(left), Math.abs(right), 1);
    return absolute / scale <= policy.numericRelativeTolerance;
  }
  return false;
}

function canonicalBooleanFormulaRewrite(before, after) {
  const beforeFormula = String(before.formula || "").replaceAll(" ", "").toUpperCase();
  const afterFormula = String(after.formula || "").replaceAll(" ", "").toUpperCase();
  return (!before.formula && typeof before.cachedValue === "boolean" && afterFormula === `${before.cachedValue ? "TRUE" : "FALSE"}()` && after.cachedValue === before.cachedValue)
    || (!after.formula && typeof after.cachedValue === "boolean" && beforeFormula === `${after.cachedValue ? "TRUE" : "FALSE"}()` && before.cachedValue === after.cachedValue);
}

function canonicalFormula(formula) {
  return String(formula || "")
    .replace(/'([A-Za-z_][A-Za-z0-9_.]*)'!/g, "$1!")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/\b(TRUE|FALSE)\(\)/g, "$1");
}

function canonicalFormulaSerialization(before, after) {
  return Boolean(before.formula && after.formula && canonicalFormula(before.formula) === canonicalFormula(after.formula));
}

function canonicalCalculationMode(value) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return null;
  if (["auto", "autonotable", "on_change"].includes(normalized)) return "automatic";
  if (["minute", "hour"].includes(normalized)) return "periodic";
  if (normalized === "manual") return "manual";
  return normalized;
}

export function compareSnapshots(source, engineSnapshot, suppliedPolicy = {}, { symmetric = false, referenceSnapshot = null } = {}) {
  const policy = { ...DEFAULT_POLICY, ...suppliedPolicy };
  const differences = [];
  const sourceCells = cellMap(source);
  const engineCells = cellMap(engineSnapshot);
  const keys = [...new Set([...sourceCells.keys(), ...engineCells.keys()])].sort();

  for (const key of keys) {
    const before = sourceCells.get(key);
    const after = engineCells.get(key);
    if (!before || !after) {
      const present = before || after;
      if (!present?.formula && present?.cachedValue === null) continue;
      differences.push({
        kind: "cell_presence",
        location: key,
        before: before || null,
        after: after || null,
        material: true,
        reason: before ? "cell_lost" : "cell_added",
      });
      continue;
    }
    const formulaChanged = (before.formula || null) !== (after.formula || null);
    if (formulaChanged) {
      const canonicalBoolean = canonicalBooleanFormulaRewrite(before, after);
      const canonicalSerialization = canonicalFormulaSerialization(before, after);
      differences.push({
        kind: "formula",
        location: key,
        before: before.formula,
        after: after.formula,
        material: canonicalBoolean || canonicalSerialization ? false : policy.formulaChangeIsMaterial,
        reason: canonicalBoolean ? "canonical_boolean_formula_rewrite" : canonicalSerialization ? "canonical_formula_serialization" : "formula_changed",
      });
    }
    const ignored = (policy.ignoreVolatileFormulaValues && (before.volatile || after.volatile))
      || (policy.ignoreExternalFormulaValues && (before.external || after.external));
    if (!equalValue(before.cachedValue, after.cachedValue, policy)) {
      const errorChange = before.valueType === "error" || after.valueType === "error";
      differences.push({
        kind: errorChange ? "error" : "value",
        location: key,
        before: before.cachedValue,
        after: after.cachedValue,
        beforeType: before.valueType,
        afterType: after.valueType,
        material: ignored ? false : (errorChange ? policy.errorChangeIsMaterial : true),
        reason: ignored ? "ignored_environment_dependent_formula" : (errorChange ? "error_changed" : "value_changed"),
      });
    }
  }

  const sourceSheets = new Set((source?.workbook?.sheets || []).map((sheet) => sheet.name));
  const engineSheets = new Set((engineSnapshot?.workbook?.sheets || []).map((sheet) => sheet.name));
  for (const name of [...sourceSheets].filter((name) => !engineSheets.has(name)).sort()) {
    differences.push({ kind: "structure", objectType: "sheet", name, material: policy.structuralLossIsMaterial, reason: "sheet_lost" });
  }
  for (const name of [...engineSheets].filter((name) => !sourceSheets.has(name)).sort()) {
    differences.push({ kind: "structure", objectType: "sheet", name, material: symmetric && policy.structuralLossIsMaterial, reason: "sheet_added" });
  }

  const sourceSheetMap = new Map((source?.workbook?.sheets || []).map((sheet) => [sheet.name, sheet]));
  const engineSheetMap = new Map((engineSnapshot?.workbook?.sheets || []).map((sheet) => [sheet.name, sheet]));
  const referenceSheetMap = new Map((referenceSnapshot?.workbook?.sheets || []).map((sheet) => [sheet.name, sheet]));
  const numericSheetFeatures = [
    ["mergedCellCount", "mergedCells"],
    ["conditionalFormattingCount", "conditionalFormats"],
    ["dataValidationCount", "dataValidations"],
    ["headerFooterCount", "headersAndFooters"],
    ["frozenPaneCount", "frozenPanes"],
    ["ignoredErrorCount", "ignoredErrors"],
    ["rowBreakCount", "rowBreaks"],
    ["columnBreakCount", "columnBreaks"],
    ["maximumRowOutlineLevel", "rowOutlineLevel"],
    ["tablePartCount", "tableParts"],
    ["hyperlinkCount", "hyperlinks"],
  ];
  for (const [name, sourceSheet] of sourceSheetMap) {
    const engineSheet = engineSheetMap.get(name);
    if (!engineSheet) continue;
    const beforeState = sourceSheet.state || "visible";
    const afterState = engineSheet.state || "visible";
    if (beforeState !== afterState) {
      differences.push({
        kind: "structure",
        objectType: "sheetState",
        name,
        before: beforeState,
        after: afterState,
        material: policy.structuralLossIsMaterial,
        reason: "sheet_visibility_state_changed",
      });
    }
    for (const [feature, objectType] of numericSheetFeatures) {
      const beforeValue = sourceSheet?.features?.[feature];
      const afterValue = engineSheet?.features?.[feature];
      if (beforeValue === undefined || beforeValue === null || afterValue === undefined || afterValue === null) continue;
      const before = Number(beforeValue);
      const after = Number(afterValue);
      if (before === after) continue;
      const decreased = after < before;
      const referenceCount = Number(referenceSheetMap.get(name)?.features?.[feature] || 0);
      differences.push({
        kind: "structure",
        objectType,
        name,
        before,
        after,
        material: policy.structuralLossIsMaterial && (decreased || (symmetric && (!referenceSnapshot || referenceCount > 0))),
        reason: decreased ? "worksheet_feature_count_decreased" : "worksheet_feature_count_increased",
      });
    }
    for (const [feature, objectType] of [
      ["autoFilter", "autoFilter"],
      ["sheetProtectionPresent", "sheetProtection"],
      ["landscapeOrientationPresent", "landscapePageOrientation"],
    ]) {
      const beforeValue = sourceSheet?.features?.[feature];
      const afterValue = engineSheet?.features?.[feature];
      if (beforeValue === undefined || afterValue === undefined) continue;
      const before = Boolean(beforeValue);
      const after = Boolean(afterValue);
      if (before === after) continue;
      const removed = before && !after;
      const referenceEnabled = Boolean(referenceSheetMap.get(name)?.features?.[feature]);
      differences.push({
        kind: "structure",
        objectType,
        name,
        before,
        after,
        material: policy.structuralLossIsMaterial && (removed || (symmetric && (!referenceSnapshot || referenceEnabled))),
        reason: removed ? "worksheet_feature_removed" : "worksheet_feature_added",
      });
    }
  }

  const sourceObjects = new Map((source?.workbook?.namedObjects || []).map((object) => [namedObjectKey(object), object]));
  const engineObjects = new Map((engineSnapshot?.workbook?.namedObjects || []).map((object) => [namedObjectKey(object), object]));
  for (const [key, object] of [...sourceObjects.entries()].sort()) {
    if (!engineObjects.has(key)) {
      differences.push({ kind: "structure", objectType: object.type, name: object.name || object.part, before: object, after: null, material: policy.structuralLossIsMaterial, reason: "named_object_lost" });
    }
  }
  if (symmetric) {
    for (const [key, object] of [...engineObjects.entries()].sort()) {
      if (!sourceObjects.has(key)) {
        differences.push({ kind: "structure", objectType: object.type, name: object.name || object.part, before: null, after: object, material: policy.structuralLossIsMaterial, reason: "named_object_added" });
      }
    }
  }

  for (const feature of ["images", "charts", "tables", "pivotTables", "externalLinks", "comments", "customProperties"]) {
    const before = Number(source?.package?.features?.[feature] || 0);
    const observedAfter = engineSnapshot?.package?.features?.[feature];
    if (observedAfter === undefined || observedAfter === null) continue;
    const after = Number(observedAfter);
    if (after !== before) {
      const decreased = after < before;
      const referenceCount = Number(referenceSnapshot?.package?.features?.[feature] || 0);
      differences.push({
        kind: "structure",
        objectType: feature,
        before,
        after,
        material: policy.structuralLossIsMaterial && (decreased || (symmetric && (!referenceSnapshot || referenceCount > 0))),
        reason: decreased ? "package_object_count_decreased" : "package_object_count_increased",
      });
    }
  }


  const sourceProtection = source?.package?.features?.workbookProtectionPresent;
  const engineProtection = engineSnapshot?.package?.features?.workbookProtectionPresent;
  if (sourceProtection !== undefined && engineProtection !== undefined && Boolean(sourceProtection) !== Boolean(engineProtection)) {
    const removed = Boolean(sourceProtection) && !Boolean(engineProtection);
    differences.push({
      kind: "structure",
      objectType: "workbookProtection",
      before: Boolean(sourceProtection),
      after: Boolean(engineProtection),
      material: policy.structuralLossIsMaterial && (removed || (symmetric && (!referenceSnapshot || Boolean(referenceSnapshot?.package?.features?.workbookProtectionPresent)))),
      reason: removed ? "workbook_protection_removed" : "workbook_protection_added",
    });
  }

  const sourceCalculationMode = canonicalCalculationMode(source?.package?.features?.calculationMode);
  const engineCalculationMode = canonicalCalculationMode(engineSnapshot?.package?.features?.calculationMode);
  if (sourceCalculationMode && engineCalculationMode && sourceCalculationMode !== engineCalculationMode) {
    differences.push({
      kind: "structure",
      objectType: "calculationMode",
      before: sourceCalculationMode,
      after: engineCalculationMode,
      material: true,
      reason: "calculation_mode_changed",
    });
  }

  const materialDifferences = differences.filter((difference) => difference.material);
  return {
    status: materialDifferences.length === 0 ? "pass" : "fail",
    differenceCount: differences.length,
    materialDifferenceCount: materialDifferences.length,
    differences,
  };
}
