import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testWorkbook } from "../src/runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled = process.env.SHEETPARITY_INTEGRATION === "1";
const sofficePath = process.env.SHEETPARITY_SOFFICE;

test("stable LibreOffice accepts a known-good control", { skip: !enabled }, async () => {
  assert.ok(sofficePath, "SHEETPARITY_SOFFICE is required");
  const result = await testWorkbook(path.join(root, "fixtures", "corpus", "good-01-basic-arithmetic.xlsx"), { matrix: "libreoffice", sofficePath, timeoutMs: 120_000 });
  assert.equal(result.engines[0].environment.releaseChannel, "stable");
  assert.equal(result.engines[0].proofLayers.recalculatedValues, "available_after_calculateAll");
  assert.equal(result.summary.status, "pass");
});

test("stable LibreOffice exposes a stale cached value", { skip: !enabled }, async () => {
  assert.ok(sofficePath, "SHEETPARITY_SOFFICE is required");
  const result = await testWorkbook(path.join(root, "fixtures", "corpus", "bad-15-stale-cache-d4.xlsx"), { matrix: "libreoffice", sofficePath, timeoutMs: 120_000 });
  assert.equal(result.summary.status, "fail");
  const difference = result.comparisons[0].differences.find((item) => item.location === "Report!D4");
  assert.deepEqual({ before: difference.before, after: difference.after, reason: difference.reason }, { before: 999, after: 75, reason: "value_changed" });
});
