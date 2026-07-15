import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { inspectXlsx, inspectXlsxBytes } from "../src/xlsx.js";
import { compareSnapshots } from "../src/compare.js";
import { normalizeMatrix, testWorkbook } from "../src/runner.js";
import { stableResultProjection } from "../src/result.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => path.join(root, "fixtures", "corpus", name);

test("inspects a namespaced valid workbook and extracts formulas", async () => {
  const result = await inspectXlsx(fixture("good-01-basic-arithmetic.xlsx"));
  assert.equal(result.package.validZip, true);
  assert.equal(result.package.requiredPartsPresent, true);
  assert.equal(result.diagnostics.filter((item) => item.material).length, 0);
  assert.equal(result.workbook.sheets.length, 1);
  assert.equal(result.workbook.sheets[0].name, "Report");
  assert.equal(result.workbook.sheets[0].cells.D4.formula, "B4*C4");
  assert.equal(result.workbook.sheets[0].cells.D4.cachedValue, 25);
});

test("inspects in-memory XLSX bytes for managed-engine exports", async () => {
  const bytes = await fs.readFile(fixture("good-01-basic-arithmetic.xlsx"));
  const result = inspectXlsxBytes(bytes);
  assert.equal(result.path, null);
  assert.equal(result.package.validZip, true);
  assert.equal(result.workbook.sheets[0].cells.D4.cachedValue, 25);
});

test("ignores empty header and footer elements emitted by engine round trips", async () => {
  const archive = unzipSync(await fs.readFile(fixture("good-01-basic-arithmetic.xlsx")));
  const part = "xl/worksheets/sheet1.xml";
  const xml = strFromU8(archive[part]);
  archive[part] = strToU8(xml.replace(
    "</x:worksheet>",
    '<x:headerFooter differentFirst="false" differentOddEven="false"><x:oddHeader></x:oddHeader><x:oddFooter>   </x:oddFooter></x:headerFooter></x:worksheet>',
  ));
  const result = inspectXlsxBytes(zipSync(archive));
  assert.equal(result.workbook.sheets[0].features.headerFooterCount, 0);
});

test("counts only active workbook-protection lock flags", async () => {
  const archive = unzipSync(await fs.readFile(fixture("good-01-basic-arithmetic.xlsx")));
  const part = "xl/workbook.xml";
  const xml = strFromU8(archive[part]);
  archive[part] = strToU8(xml.replace("<x:sheets>", '<x:workbookProtection lockStructure="false" lockWindows="0" /><x:sheets>'));
  assert.equal(inspectXlsxBytes(zipSync(archive)).package.features.workbookProtectionPresent, false);
  archive[part] = strToU8(xml.replace("<x:sheets>", '<x:workbookProtection lockStructure="1" lockWindows="0" /><x:sheets>'));
  assert.equal(inspectXlsxBytes(zipSync(archive)).package.features.workbookProtectionPresent, true);
});

test("rejects non-ZIP bytes", async () => {
  const result = await inspectXlsx(fixture("bad-01-not-a-zip.xlsx"));
  assert.equal(result.package.validZip, false);
  assert.ok(result.diagnostics.some((item) => item.code === "invalid_zip" && item.material));
});

test("validates malformed XML rather than accepting a forgiving parse", async () => {
  const result = await inspectXlsx(fixture("bad-10-malformed-worksheet-xml.xlsx"));
  assert.ok(result.diagnostics.some((item) => item.code === "invalid_xml" && item.part === "xl/worksheets/sheet1.xml"));
});

test("rejects an explicit numeric cell with an invalid lexical value", async () => {
  const result = await inspectXlsx(fixture("explore-08-phpspreadsheet-1281-decimal-comma.xlsx"));
  assert.ok(result.diagnostics.some((item) => item.code === "invalid_numeric_lexical_value" && item.cell === "C4" && item.material));
});

test("detects a validator-passing stale formula cache after recalculation", async () => {
  const stale = await inspectXlsx(fixture("bad-15-stale-cache-d4.xlsx"));
  const recalculated = await inspectXlsx(path.join(root, "fixtures", "seeds", "adversarial-seed.xlsx"));
  assert.equal(stale.diagnostics.filter((item) => item.material).length, 0);
  const comparison = compareSnapshots(stale, recalculated);
  assert.equal(comparison.status, "fail");
  assert.ok(comparison.differences.some((item) => item.location === "Report!D4" && item.kind === "value" && item.before === 999 && item.after === 75));
});

test("a snapshot compared with itself passes", async () => {
  const snapshot = await inspectXlsx(fixture("good-12-chain-formulas.xlsx"));
  const comparison = compareSnapshots(snapshot, snapshot);
  assert.deepEqual(comparison, { status: "pass", differenceCount: 0, materialDifferenceCount: 0, differences: [] });
});

test("worksheet feature losses are material and engine comparisons are symmetric", () => {
  const left = {
    workbook: { sheets: [{ name: "Report", features: { headerFooterCount: 0, sheetProtectionPresent: false, dataValidationCount: 0 }, cells: {} }], namedObjects: [] },
    package: { features: { images: 0 } },
  };
  const right = {
    workbook: { sheets: [{ name: "Report", features: { headerFooterCount: 1, sheetProtectionPresent: true, dataValidationCount: 2 }, cells: {} }], namedObjects: [] },
    package: { features: { images: 1 } },
  };
  const sourceComparison = compareSnapshots(left, right);
  assert.equal(sourceComparison.status, "pass");
  assert.ok(sourceComparison.differences.every((item) => item.material === false));
  const engineComparison = compareSnapshots(left, right, {}, { symmetric: true });
  assert.equal(engineComparison.status, "fail");
  assert.ok(engineComparison.differences.some((item) => item.objectType === "headersAndFooters" && item.material));
  assert.ok(engineComparison.differences.some((item) => item.objectType === "sheetProtection" && item.material));
  assert.ok(engineComparison.differences.some((item) => item.objectType === "dataValidations" && item.material));
  assert.ok(engineComparison.differences.some((item) => item.objectType === "images" && item.material));
  const lossComparison = compareSnapshots(right, left);
  assert.equal(lossComparison.status, "fail");
  const reference = {
    workbook: { sheets: [{ name: "Report", features: { headerFooterCount: 0, sheetProtectionPresent: false, dataValidationCount: 0 }, cells: {} }], namedObjects: [] },
    package: { features: { images: 0 } },
  };
  const referenceBoundComparison = compareSnapshots(left, right, {}, { symmetric: true, referenceSnapshot: reference });
  assert.equal(referenceBoundComparison.status, "pass");
  assert.ok(referenceBoundComparison.differences.every((item) => item.material === false));
});

test("workbook policy, visibility, print, note, and calculation losses are material", () => {
  const source = {
    workbook: {
      sheets: [{
        name: "Report",
        state: "veryHidden",
        features: { frozenPaneCount: 1, landscapeOrientationPresent: true },
        cells: {},
      }],
      namedObjects: [],
    },
    package: {
      features: {
        comments: 1,
        customProperties: 1,
        workbookProtectionPresent: true,
        calculationMode: "manual",
      },
    },
  };
  const engine = {
    workbook: {
      sheets: [{
        name: "Report",
        state: "hidden",
        features: { frozenPaneCount: 0, landscapeOrientationPresent: false },
        cells: {},
      }],
      namedObjects: [],
    },
    package: {
      features: {
        comments: 0,
        customProperties: 0,
        workbookProtectionPresent: false,
        calculationMode: "ON_CHANGE",
      },
    },
  };
  const comparison = compareSnapshots(source, engine);
  assert.equal(comparison.status, "fail");
  for (const objectType of ["sheetState", "frozenPanes", "landscapePageOrientation", "comments", "customProperties", "workbookProtection", "calculationMode"]) {
    assert.ok(comparison.differences.some((item) => item.objectType === objectType && item.material), objectType);
  }
});

test("canonical TRUE/FALSE rewrites remain visible but non-material", () => {
  const source = { workbook: { sheets: [{ name: "Flags", cells: { A1: { formula: null, cachedValue: true, valueType: "boolean" } } }], namedObjects: [] }, package: { features: {} } };
  const engine = { workbook: { sheets: [{ name: "Flags", cells: { A1: { formula: "TRUE()", cachedValue: true, valueType: "boolean" } } }], namedObjects: [] }, package: { features: {} } };
  const comparison = compareSnapshots(source, engine);
  assert.equal(comparison.status, "pass");
  assert.equal(comparison.differenceCount, 1);
  assert.equal(comparison.differences[0].reason, "canonical_boolean_formula_rewrite");
  assert.equal(comparison.differences[0].material, false);
});

test("unnecessary simple-sheet quotes remain visible but non-material", () => {
  const source = { workbook: { sheets: [{ name: "Report", cells: { A1: { formula: "'Inputs'!B2*'Inputs'!B3", cachedValue: 12, valueType: "number" } } }], namedObjects: [] }, package: { features: {} } };
  const engine = { workbook: { sheets: [{ name: "Report", cells: { A1: { formula: "Inputs!B2*Inputs!B3", cachedValue: 12, valueType: "number" } } }], namedObjects: [] }, package: { features: {} } };
  const comparison = compareSnapshots(source, engine);
  assert.equal(comparison.status, "pass");
  assert.equal(comparison.differences[0].reason, "canonical_formula_serialization");
});

test("boolean constants serialized as functions inside formulas are non-material", () => {
  const source = { workbook: { sheets: [{ name: "Report", cells: { A1: { formula: "IF(FALSE,1,2)", cachedValue: 2, valueType: "number" } } }], namedObjects: [] }, package: { features: {} } };
  const engine = { workbook: { sheets: [{ name: "Report", cells: { A1: { formula: "IF(FALSE(),1,2)", cachedValue: 2, valueType: "number" } } }], namedObjects: [] }, package: { features: {} } };
  const comparison = compareSnapshots(source, engine);
  assert.equal(comparison.status, "pass");
  assert.equal(comparison.differences[0].reason, "canonical_formula_serialization");
  assert.equal(comparison.differences[0].material, false);
});

test("matrix names are explicit about Excel surfaces", () => {
  assert.deepEqual(normalizeMatrix("lo,google,excel-web"), ["libreoffice", "google-sheets", "excel-web"]);
  assert.throws(() => normalizeMatrix("excel"), /ambiguous/);
});

test("credentialed adapters expose exact requirements without credentials", async () => {
  const result = await testWorkbook(fixture("good-01-basic-arithmetic.xlsx"), { matrix: "excel-web,google-sheets" });
  assert.equal(result.summary.status, "incomplete");
  assert.equal(result.summary.unavailableEngineCount, 2);
  assert.match(result.engines[0].open.messages[0], /Microsoft Entra/);
  assert.match(result.engines[1].open.messages[0], /Google Cloud/);
  assert.equal(result.engines[0].label, "Excel Web");
  assert.deepEqual(result.engineComparisons, []);
  assert.equal(result.summary.engineMaterialDifferenceCount, 0);
});

test("normalized results include material pairwise engine evidence", async () => {
  const adapterFactory = (id) => ({
    async run(filePath) {
      const snapshot = await inspectXlsx(filePath);
      const workbook = structuredClone(snapshot.workbook);
      if (id === "engine-b") workbook.sheets[0].cells.D4.cachedValue = 999;
      return {
        id,
        label: id,
        kind: "local-engine",
        version: "test-1",
        status: "available",
        durationMs: 0,
        environment: { releaseChannel: "stable", locale: "C", timezone: "UTC", fontPack: "test", calculationMode: "automatic" },
        open: { outcome: "accepted", exitCode: 0, timedOut: false, messages: [] },
        proofLayers: { openImport: "available", formulas: "available", cachedValues: "available", recalculatedValues: "available", namedObjects: "available", renders: "unavailable" },
        package: snapshot.package,
        workbook,
        diagnostics: [],
      };
    },
  });
  const result = await testWorkbook(fixture("good-01-basic-arithmetic.xlsx"), { matrix: "engine-a,engine-b", adapterFactory });
  assert.equal(result.engineComparisons.length, 1);
  assert.equal(result.engineComparisons[0].leftEngineId, "engine-a");
  assert.equal(result.engineComparisons[0].rightEngineId, "engine-b");
  assert.equal(result.engineComparisons[0].materialDifferenceCount, 1);
  assert.equal(result.summary.engineMaterialDifferenceCount, 1);
  assert.equal(result.summary.status, "fail");
});

test("stable fingerprint projection excludes time and process noise", async () => {
  const result = await testWorkbook(fixture("good-01-basic-arithmetic.xlsx"), { matrix: "excel-web" });
  const changed = structuredClone(result);
  changed.generatedAt = "2099-01-01T00:00:00.000Z";
  changed.engines[0].durationMs = 999999;
  changed.engines[0].open.messages = ["different temp path"];
  assert.deepEqual(stableResultProjection(changed), stableResultProjection(result));
});

test("stable fingerprint projection excludes nondeterministic managed export bytes", async () => {
  const result = await testWorkbook(fixture("good-01-basic-arithmetic.xlsx"), { matrix: "excel-web" });
  result.engines[0].diagnostics.push({
    code: "xlsx_roundtrip_export_inspected",
    severity: "info",
    material: false,
    sizeBytes: 8497,
    sha256: "a".repeat(64),
    message: "Managed export inspected",
  });
  const changed = structuredClone(result);
  changed.engines[0].diagnostics.at(-1).sizeBytes = 8512;
  changed.engines[0].diagnostics.at(-1).sha256 = "b".repeat(64);
  assert.deepEqual(stableResultProjection(changed), stableResultProjection(result));
});

test("result schema is valid JSON and declares all proof surfaces", async () => {
  const schema = JSON.parse(await fs.readFile(path.join(root, "schemas", "result.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "1.0.0");
  const required = schema.$defs.engine.properties.proofLayers.required;
  assert.deepEqual(required, ["openImport", "formulas", "cachedValues", "recalculatedValues", "namedObjects", "renders"]);
  assert.ok(schema.required.includes("engineComparisons"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const result = await testWorkbook(fixture("good-01-basic-arithmetic.xlsx"), { matrix: "excel-web" });
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("fixture manifest is complete, licensed, and hash-pinned", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "fixtures", "manifest.json"), "utf8"));
  assert.equal(manifest.fixtureCount, 68);
  assert.equal(manifest.fixtures.filter((item) => item.classification === "known-good").length, 20);
  assert.equal(manifest.fixtures.filter((item) => item.classification === "known-bad").length, 20);
  assert.equal(manifest.fixtures.filter((item) => item.classification === "exploratory").length, 28);
  assert.ok(manifest.fixtures.filter((item) => item.packageWellFormed && item.semanticDivergence).length >= 5);
  const publicCandidate = manifest.fixtures.find((item) => item.id === "explore-08-phpspreadsheet-1281-decimal-comma");
  assert.equal(publicCandidate.publicSilentValueCandidate, true);
  assert.equal(publicCandidate.publicSilentValueFixture, false);
  assert.match(publicCandidate.provenance[0], /PhpSpreadsheet\/issues\/1281/);
  const followup = manifest.fixtures.filter((item) => item.prospectiveRound === "followup-2026-07-15-round-2");
  assert.equal(followup.length, 6);
  assert.ok(followup.every((item) => item.packageWellFormed));
  const roundThree = manifest.fixtures.filter((item) => item.prospectiveRound === "followup-2026-07-15-round-3");
  assert.equal(roundThree.length, 12);
  assert.ok(roundThree.every((item) => item.packageWellFormed));
  assert.ok(roundThree.every((item) => item.provenance.length > 0));
  for (const entry of manifest.fixtures) {
    assert.equal(entry.license, "CC0-1.0");
    assert.equal(entry.copiedThirdPartyBytes, false);
    const bytes = await fs.readFile(path.join(root, "fixtures", entry.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.id);
  }
});
