import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compareSnapshots } from "../src/compare.js";
import { googleSheetsAdapter, normalizeGoogleSpreadsheet } from "../src/adapters/google-sheets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => path.join(root, "fixtures", "corpus", name);
const exportedWorkbook = await fs.readFile(fixture("good-01-basic-arithmetic.xlsx"));

function sampleSpreadsheet() {
  return {
    spreadsheetId: "temporary-spreadsheet-id",
    properties: { title: "fixture", locale: "en_US", timeZone: "Etc/UTC", autoRecalc: "ON_CHANGE" },
    namedRanges: [{ name: "Revenue", range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 3, endColumnIndex: 4 } }],
    sheets: [{
      properties: { sheetId: 0, title: "Report", index: 0, sheetType: "GRID", gridProperties: { rowCount: 10, columnCount: 8 } },
      merges: [{ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 }],
      conditionalFormats: [{}],
      charts: [{ chartId: 7 }],
      tables: [{ tableId: "table-1", name: "RevenueTable" }],
      data: [{
        startRow: 3,
        startColumn: 3,
        rowData: [{ values: [{
          userEnteredValue: { formulaValue: "=B4*C4" },
          effectiveValue: { numberValue: 75 },
          formattedValue: "75",
        }] }],
      }, {
        startRow: 4,
        startColumn: 3,
        rowData: [{ values: [{
          userEnteredValue: { formulaValue: "=1/0" },
          effectiveValue: { errorValue: { type: "DIVIDE_BY_ZERO", message: "Function DIVIDE parameter 2 cannot be zero." } },
          formattedValue: "#DIV/0!",
          pivotTable: { source: {} },
        }] }],
      }],
    }],
  };
}

test("normalizes Google formula, effective value, errors, names, and observable structures", () => {
  const normalized = normalizeGoogleSpreadsheet(sampleSpreadsheet());
  const report = normalized.workbook.sheets[0];
  assert.equal(report.cells.D4.formula, "B4*C4");
  assert.equal(report.cells.D4.cachedValue, 75);
  assert.equal(report.cells.D4.valueType, "number");
  assert.equal(report.cells.D5.cachedValue, "#DIV/0!");
  assert.equal(report.cells.D5.valueType, "error");
  assert.equal(report.features.mergedCellCount, 1);
  assert.equal(normalized.package.features.charts, 1);
  assert.equal(normalized.package.features.tables, 1);
  assert.equal(normalized.package.features.pivotTables, 1);
  assert.equal(normalized.workbook.namedObjects[0].name, "Revenue");
});

test("imports, reads twice for stability, and permanently deletes the remote Google Sheet", async () => {
  const calls = [];
  const payload = sampleSpreadsheet();
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });
    if (String(url).includes("upload/drive/v3/files")) {
      assert.match(init.headers["content-type"], /^multipart\/related/);
      assert.ok(Buffer.isBuffer(init.body));
      assert.match(init.body.toString("utf8"), /shared-drive-test-folder/);
      return Response.json({ id: "temporary-spreadsheet-id", mimeType: "application/vnd.google-apps.spreadsheet" });
    }
    if (String(url).includes("sheets.googleapis.com")) return Response.json(payload);
    if (String(url).includes("/export?")) return new Response(exportedWorkbook, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    if (String(url).includes("drive/v3/files/temporary-spreadsheet-id")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const adapter = googleSheetsAdapter({
    googleCredentials: { type: "service_account" },
    googleFolderId: "shared-drive-test-folder",
    tokenProvider: async () => "short-lived-test-token",
    fetchImpl,
    pollMs: 0,
  });
  const result = await adapter.run(fixture("bad-15-stale-cache-d4.xlsx"));
  assert.equal(result.status, "available");
  assert.equal(result.version, null);
  assert.equal(result.open.outcome, "accepted");
  assert.equal(result.workbook.sheets[0].cells.D4.cachedValue, 75);
  assert.equal(result.environment.remoteRetention, "permanently_deleted");
  assert.match(result.proofLayers.recalculatedValues, /two_stable_reads/);
  assert.equal(result.proofLayers.structures, "available_exported_xlsx_roundtrip");
  assert.equal(result.package.validZip, true);
  const sheetsCalls = calls.filter((call) => call.url.includes("sheets.googleapis.com"));
  const stableReads = sheetsCalls.filter((call) => call.method === "GET");
  const recalcMutations = sheetsCalls.filter((call) => call.method === "POST" || call.method === "PUT");
  assert.equal(stableReads.length, 2);
  assert.equal(recalcMutations.length, 3);
  assert.match(recalcMutations[0].body, /addSheet/);
  assert.match(recalcMutations[1].body, /sheetparity-recalc-trigger/);
  assert.match(recalcMutations[2].body, /deleteSheet/);
  const fields = new URL(stableReads[0].url).searchParams.get("fields");
  assert.match(fields, /^spreadsheetId,properties\(/);
  assert.match(fields, /,namedRanges\(/);
  assert.match(fields, /,sheets\(/);
  assert.match(result.proofLayers.recalculatedValues, /edit_trigger/);
  assert.equal(calls.filter((call) => call.url.includes("/export?")).length, 1);
  assert.equal(calls.at(-1).method, "DELETE");
});

test("a remote cleanup failure is a material engine error", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("upload/drive/v3/files")) return Response.json({ id: "temporary-spreadsheet-id", mimeType: "application/vnd.google-apps.spreadsheet" });
    if (String(url).includes("sheets.googleapis.com")) return Response.json(sampleSpreadsheet());
    if (String(url).includes("/export?")) return new Response(exportedWorkbook);
    if (String(url).includes("drive/v3/files/temporary-spreadsheet-id")) return Response.json({ error: { message: "delete denied" } }, { status: 403 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await googleSheetsAdapter({
    googleCredentials: { type: "service_account" },
    googleFolderId: "shared-drive-test-folder",
    tokenProvider: async () => "short-lived-test-token",
    fetchImpl,
    pollMs: 0,
  }).run(fixture("good-01-basic-arithmetic.xlsx"));
  assert.equal(result.status, "error");
  assert.equal(result.environment.remoteRetention, "cleanup_failed");
  assert.ok(result.diagnostics.some((item) => item.code === "remote_cleanup_failed" && item.material));
});

test("service-account JWT uses only the documented minimum scopes", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials = {
    type: "service_account",
    client_email: "sheetparity-test@example.invalid",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  };
  let tokenChecked = false;
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === credentials.token_uri) {
      const body = new URLSearchParams(String(init.body));
      const [header, claims, signature] = body.get("assertion").split(".");
      const decoded = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
      assert.equal(decoded.iss, credentials.client_email);
      assert.equal(decoded.scope, "https://www.googleapis.com/auth/drive.file");
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${header}.${claims}`);
      verifier.end();
      assert.equal(verifier.verify(publicKey, signature, "base64url"), true);
      tokenChecked = true;
      return Response.json({ access_token: "signed-test-token", expires_in: 3600, token_type: "Bearer" });
    }
    assert.equal(init.headers.authorization, "Bearer signed-test-token");
    if (String(url).includes("upload/drive/v3/files")) return Response.json({ id: "temporary-spreadsheet-id", mimeType: "application/vnd.google-apps.spreadsheet" });
    if (String(url).includes("sheets.googleapis.com")) return Response.json(sampleSpreadsheet());
    if (String(url).includes("/export?")) return new Response(exportedWorkbook);
    if (String(url).includes("drive/v3/files/temporary-spreadsheet-id")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await googleSheetsAdapter({
    googleCredentials: credentials,
    googleFolderId: "shared-drive-test-folder",
    fetchImpl,
    pollMs: 0,
  }).run(fixture("good-01-basic-arithmetic.xlsx"));
  assert.equal(tokenChecked, true);
  assert.equal(result.status, "available");
});

test("authorized-user credentials refresh with the OAuth client instead of ambient browser state", async () => {
  const credentials = {
    type: "authorized_user",
    client_id: "desktop-client-id",
    client_secret: "desktop-client-secret",
    refresh_token: "dedicated-refresh-token",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  let tokenChecked = false;
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === credentials.token_uri) {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("client_id"), credentials.client_id);
      assert.equal(body.get("client_secret"), credentials.client_secret);
      assert.equal(body.get("refresh_token"), credentials.refresh_token);
      assert.equal(body.get("grant_type"), "refresh_token");
      tokenChecked = true;
      return Response.json({ access_token: "refreshed-user-token", expires_in: 3600, token_type: "Bearer" });
    }
    assert.equal(init.headers.authorization, "Bearer refreshed-user-token");
    if (String(url).includes("upload/drive/v3/files")) return Response.json({ id: "temporary-spreadsheet-id", mimeType: "application/vnd.google-apps.spreadsheet" });
    if (String(url).includes("sheets.googleapis.com")) return Response.json(sampleSpreadsheet());
    if (String(url).includes("/export?")) return new Response(exportedWorkbook);
    if (String(url).includes("drive/v3/files/temporary-spreadsheet-id")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await googleSheetsAdapter({
    googleCredentials: credentials,
    googleFolderId: "oauth-created-test-folder",
    fetchImpl,
    pollMs: 0,
  }).run(fixture("good-01-basic-arithmetic.xlsx"));
  assert.equal(tokenChecked, true);
  assert.equal(result.status, "available");
  assert.equal(result.environment.remoteRetention, "permanently_deleted");
});

test("unobservable Google feature layers do not become invented structural losses", () => {
  const workbook = { sheets: [{ name: "Report", state: "visible", part: null, features: {}, cells: {} }], namedObjects: [] };
  const source = { workbook, package: { features: { images: 1 } } };
  const google = { workbook, package: { features: {} } };
  assert.equal(compareSnapshots(source, google).status, "pass");
});
