import fs from "node:fs/promises";
import path from "node:path";
import { createSign, randomInt, randomUUID } from "node:crypto";
import { sha256, stableStringify } from "../result.js";
import { inspectXlsxBytes } from "../xlsx.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const MULTIPART_LIMIT = 5 * 1024 * 1024;
const VOLATILE_FUNCTIONS = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|OFFSET|INDIRECT|CELL|INFO)\s*\(/i;
const EXTERNAL_FORMULA = /\[[^\]]+\]|https?:\/\/|\\\\/i;

export const GOOGLE_SHEETS_REQUIREMENT = "Google Cloud project with Drive and Sheets APIs enabled, SHEETPARITY_GOOGLE_CREDENTIALS pointing to either a service-account key for a Shared Drive or an explicit authorized-user credential for a dedicated test account, and SHEETPARITY_GOOGLE_TEST_FOLDER_ID for an isolated folder where SheetParity can create and permanently delete files. Ambient ADC and browser cookies are never used by the adapter.";

const SHEETS_FIELDS = [
  "spreadsheetId",
  "properties(title,locale,timeZone,autoRecalc)",
  "namedRanges(name,range)",
  "sheets(properties(sheetId,title,index,sheetType,hidden,gridProperties),merges,basicFilter,conditionalFormats,charts(chartId),tables(tableId,name,range),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,dataValidation,pivotTable))))",
].join(",");

class GoogleAdapterError extends Error {
  constructor(message, { code = "google_api_error", status = null, timedOut = false } = {}) {
    super(message);
    this.name = "GoogleAdapterError";
    this.code = code;
    this.status = status;
    this.timedOut = timedOut;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailableResult(started, message = GOOGLE_SHEETS_REQUIREMENT) {
  return {
    id: "google-sheets",
    label: "Google Sheets",
    kind: "credentialed-service",
    version: null,
    status: "unavailable",
    durationMs: Date.now() - started,
    environment: {
      endpoint: "Google Sheets API v4 / Drive API v3",
      releaseChannel: "unknown",
      locale: null,
      timezone: null,
      fontPack: null,
      calculationMode: null,
    },
    open: { outcome: "unavailable", exitCode: null, timedOut: false, messages: [message] },
    proofLayers: {
      openImport: "unavailable",
      formulas: "unavailable",
      cachedValues: "unavailable",
      recalculatedValues: "unavailable",
      namedObjects: "unavailable",
      renders: "unavailable",
    },
    workbook: { sheets: [], namedObjects: [] },
    diagnostics: [{ code: "adapter_unavailable", severity: "info", material: false, message }],
  };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function safeApiMessage(text, status) {
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || payload?.error_description || `Google API request failed with HTTP ${status}`;
  } catch {
    return text.trim().slice(0, 500) || `Google API request failed with HTTP ${status}`;
  }
}

async function request(fetchImpl, url, init, deadline, { retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GoogleAdapterError("Google Sheets adapter exceeded its deadline", { code: "engine_timeout", timedOut: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (response.ok) return response;
      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < retries) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        const delay = Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.min(retryAfter * 1000, 5_000)
          : Math.min(250 * (2 ** attempt), 2_000);
        attempt += 1;
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
        continue;
      }
      throw new GoogleAdapterError(safeApiMessage(body, response.status), { status: response.status });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new GoogleAdapterError("Google Sheets API request timed out", { code: "engine_timeout", timedOut: true });
      }
      if (error instanceof GoogleAdapterError) throw error;
      if (attempt < retries) {
        attempt += 1;
        await sleep(Math.min(250 * (2 ** (attempt - 1)), Math.max(0, deadline - Date.now())));
        continue;
      }
      throw new GoogleAdapterError(error?.message || "Google Sheets API request failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

async function serviceAccountAccessToken(credentials, fetchImpl, deadline) {
  if (credentials?.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
    throw new GoogleAdapterError("SHEETPARITY_GOOGLE_CREDENTIALS must point to a Google service-account JSON key", { code: "invalid_credentials" });
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await request(fetchImpl, credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, deadline, { retries: 1 });
  const payload = await response.json();
  if (!payload.access_token) throw new GoogleAdapterError("Google OAuth token response did not contain an access token", { code: "invalid_token_response" });
  return payload.access_token;
}

async function authorizedUserAccessToken(credentials, fetchImpl, deadline) {
  if (!credentials?.client_id || !credentials.client_secret || !credentials.refresh_token) {
    throw new GoogleAdapterError("An authorized-user credential must contain client_id, client_secret, and refresh_token", { code: "invalid_credentials" });
  }
  const body = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    refresh_token: credentials.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await request(fetchImpl, credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, deadline, { retries: 1 });
  const payload = await response.json();
  if (!payload.access_token) throw new GoogleAdapterError("Google OAuth refresh response did not contain an access token", { code: "invalid_token_response" });
  return payload.access_token;
}

async function accessTokenForCredentials(credentials, fetchImpl, deadline) {
  if (credentials?.type === "service_account") return serviceAccountAccessToken(credentials, fetchImpl, deadline);
  if (credentials?.type === "authorized_user") return authorizedUserAccessToken(credentials, fetchImpl, deadline);
  throw new GoogleAdapterError("SHEETPARITY_GOOGLE_CREDENTIALS must contain a service_account or authorized_user Google credential", { code: "invalid_credentials" });
}

function authorization(accessToken, extra = {}) {
  return { authorization: `Bearer ${accessToken}`, ...extra };
}

async function multipartUpload(bytes, metadata, accessToken, fetchImpl, deadline) {
  const boundary = `sheetparity-${randomUUID()}`;
  const before = Buffer.from([
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    `${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: ${XLSX_MIME}\r\n\r\n`,
  ].join(""));
  const after = Buffer.from(`\r\n--${boundary}--\r\n`);
  const response = await request(fetchImpl, `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,driveId`, {
    method: "POST",
    headers: authorization(accessToken, { "content-type": `multipart/related; boundary=${boundary}` }),
    body: Buffer.concat([before, bytes, after]),
  }, deadline);
  return response.json();
}

async function resumableUpload(bytes, metadata, accessToken, fetchImpl, deadline) {
  const initialization = await request(fetchImpl, `${DRIVE_UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,parents,driveId`, {
    method: "POST",
    headers: authorization(accessToken, {
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": XLSX_MIME,
      "x-upload-content-length": String(bytes.byteLength),
    }),
    body: JSON.stringify(metadata),
  }, deadline);
  const uploadUrl = initialization.headers.get("location");
  if (!uploadUrl) throw new GoogleAdapterError("Google Drive resumable upload did not return a Location header", { code: "invalid_upload_response" });
  const upload = await request(fetchImpl, uploadUrl, {
    method: "PUT",
    headers: authorization(accessToken, { "content-type": XLSX_MIME, "content-length": String(bytes.byteLength) }),
    body: bytes,
  }, deadline);
  return upload.json();
}

async function createNativeSpreadsheet(filePath, folderId, accessToken, fetchImpl, deadline) {
  const bytes = await fs.readFile(filePath);
  const metadata = {
    name: `sheetparity-${path.basename(filePath, path.extname(filePath))}-${randomUUID()}`,
    mimeType: GOOGLE_SHEETS_MIME,
    parents: [folderId],
  };
  const created = bytes.byteLength <= MULTIPART_LIMIT
    ? await multipartUpload(bytes, metadata, accessToken, fetchImpl, deadline)
    : await resumableUpload(bytes, metadata, accessToken, fetchImpl, deadline);
  if (!created?.id || created.mimeType !== GOOGLE_SHEETS_MIME) {
    throw new GoogleAdapterError("Google Drive did not return a native Google Sheets file after XLSX import", { code: "invalid_import_response" });
  }
  return created;
}

async function triggerCalculation(fileId, accessToken, fetchImpl, deadline) {
  const sheetId = randomInt(1, 2_000_000_000);
  const title = `_sheetparity_recalc_${randomUUID().replaceAll("-", "")}`;
  const batchUrl = `${SHEETS_URL}/${encodeURIComponent(fileId)}:batchUpdate`;
  await request(fetchImpl, batchUrl, {
    method: "POST",
    headers: authorization(accessToken, { "content-type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ requests: [{ addSheet: { properties: { sheetId, title, hidden: true } } }] }),
  }, deadline);
  await request(fetchImpl, `${SHEETS_URL}/${encodeURIComponent(fileId)}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: authorization(accessToken, { "content-type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ range: `${title}!A1`, majorDimension: "ROWS", values: [["sheetparity-recalc-trigger"]] }),
  }, deadline);
  await request(fetchImpl, batchUrl, {
    method: "POST",
    headers: authorization(accessToken, { "content-type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
  }, deadline);
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function normalizedError(cell, errorValue) {
  if (String(cell?.formattedValue || "").startsWith("#")) return cell.formattedValue;
  const values = {
    ERROR: "#ERROR!",
    NULL_VALUE: "#NULL!",
    DIVIDE_BY_ZERO: "#DIV/0!",
    VALUE: "#VALUE!",
    REF: "#REF!",
    NAME: "#NAME?",
    NUM: "#NUM!",
    N_A: "#N/A",
    LOADING: "#LOADING!",
  };
  return values[errorValue?.type] || `#${errorValue?.type || "ERROR"}!`;
}

function effectiveCellValue(cell) {
  const value = cell?.effectiveValue ?? cell?.userEnteredValue;
  if (!value) return { value: null, valueType: "blank" };
  if (Object.hasOwn(value, "numberValue")) return { value: value.numberValue, valueType: "number" };
  if (Object.hasOwn(value, "stringValue")) return { value: value.stringValue, valueType: "string" };
  if (Object.hasOwn(value, "boolValue")) return { value: value.boolValue, valueType: "boolean" };
  if (Object.hasOwn(value, "errorValue")) return { value: normalizedError(cell, value.errorValue), valueType: "error" };
  if (Object.hasOwn(value, "formulaValue")) return { value: null, valueType: "blank" };
  return { value: null, valueType: "unknown" };
}

function countPivots(sheet) {
  let count = 0;
  for (const grid of sheet?.data || []) {
    for (const row of grid?.rowData || []) {
      for (const cell of row?.values || []) if (cell?.pivotTable) count += 1;
    }
  }
  return count;
}

export function normalizeGoogleSpreadsheet(spreadsheet) {
  const sheets = (spreadsheet?.sheets || []).map((sheet) => {
    const cells = {};
    for (const grid of sheet?.data || []) {
      const startRow = grid?.startRow || 0;
      const startColumn = grid?.startColumn || 0;
      for (const [rowOffset, row] of (grid?.rowData || []).entries()) {
        for (const [columnOffset, cell] of (row?.values || []).entries()) {
          const formula = cell?.userEnteredValue?.formulaValue?.replace(/^=/, "") || null;
          const decoded = effectiveCellValue(cell);
          const hasEnteredValue = Boolean(cell?.userEnteredValue && Object.keys(cell.userEnteredValue).length);
          if (!formula && !hasEnteredValue && decoded.value === null) continue;
          const ref = `${columnName(startColumn + columnOffset)}${startRow + rowOffset + 1}`;
          cells[ref] = {
            formula,
            cachedValue: decoded.value,
            valueType: decoded.valueType,
            styleIndex: null,
            volatile: Boolean(formula && VOLATILE_FUNCTIONS.test(formula)),
            external: Boolean(formula && EXTERNAL_FORMULA.test(formula)),
          };
        }
      }
    }
    const charts = sheet?.charts?.length || 0;
    const tables = sheet?.tables?.length || 0;
    return {
      name: sheet?.properties?.title || null,
      state: sheet?.properties?.hidden ? "hidden" : "visible",
      part: null,
      features: {
        sheetType: sheet?.properties?.sheetType || "GRID",
        autoFilter: sheet?.basicFilter ? "present" : null,
        mergedCellCount: sheet?.merges?.length || 0,
        conditionalFormattingCount: sheet?.conditionalFormats?.length || 0,
        tablePartCount: tables,
        drawingRelationship: null,
        hasDrawing: charts > 0,
        hasHyperlinks: null,
      },
      cells,
    };
  });
  const namedObjects = (spreadsheet?.namedRanges || []).map((entry) => ({
    type: "definedName",
    name: entry?.name || null,
    localSheetId: null,
    hidden: false,
    formula: null,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    package: {
      features: {
        macros: false,
        charts: (spreadsheet?.sheets || []).reduce((sum, sheet) => sum + (sheet?.charts?.length || 0), 0),
        tables: (spreadsheet?.sheets || []).reduce((sum, sheet) => sum + (sheet?.tables?.length || 0), 0),
        pivotTables: (spreadsheet?.sheets || []).reduce((sum, sheet) => sum + countPivots(sheet), 0),
        calculationMode: spreadsheet?.properties?.autoRecalc || null,
      },
    },
    workbook: { sheets, namedObjects },
  };
}

function calculationProjection(snapshot) {
  return {
    sheets: (snapshot?.workbook?.sheets || []).map((sheet) => ({
      name: sheet.name,
      state: sheet.state,
      cells: Object.fromEntries(Object.entries(sheet.cells || {}).map(([ref, cell]) => [ref, {
        formula: cell.formula,
        value: cell.volatile ? "<volatile>" : cell.cachedValue,
        valueType: cell.valueType,
      }])),
    })),
    namedObjects: snapshot?.workbook?.namedObjects || [],
    features: snapshot?.package?.features || {},
  };
}

function hasLoadingCell(spreadsheet) {
  return (spreadsheet?.sheets || []).some((sheet) => (sheet?.data || []).some((grid) => (grid?.rowData || []).some((row) => (row?.values || []).some((cell) => cell?.effectiveValue?.errorValue?.type === "LOADING"))));
}

async function readStableSpreadsheet(fileId, accessToken, fetchImpl, deadline, pollMs) {
  let previousFingerprint = null;
  let stableReads = 0;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const query = new URLSearchParams({ includeGridData: "true", fields: SHEETS_FIELDS });
    const response = await request(fetchImpl, `${SHEETS_URL}/${encodeURIComponent(fileId)}?${query}`, {
      method: "GET",
      headers: authorization(accessToken),
    }, deadline);
    const spreadsheet = await response.json();
    lastSnapshot = normalizeGoogleSpreadsheet(spreadsheet);
    const fingerprint = sha256(stableStringify(calculationProjection(lastSnapshot)));
    if (!hasLoadingCell(spreadsheet) && fingerprint === previousFingerprint) stableReads += 1;
    else stableReads = 1;
    previousFingerprint = fingerprint;
    if (stableReads >= 2) return { spreadsheet, snapshot: lastSnapshot, stableReads };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  throw new GoogleAdapterError("Google Sheets values did not reach two stable reads before the deadline", { code: "calculation_stability_unproven", timedOut: true });
}

async function exportNativeSpreadsheet(fileId, accessToken, fetchImpl, deadline) {
  const query = new URLSearchParams({ mimeType: XLSX_MIME });
  const response = await request(fetchImpl, `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export?${query}`, {
    method: "GET",
    headers: authorization(accessToken),
  }, deadline, { retries: 2 });
  const bytes = Buffer.from(await response.arrayBuffer());
  const snapshot = inspectXlsxBytes(bytes);
  const materialDiagnostics = snapshot.diagnostics.filter((item) => item.material);
  if (!snapshot.package.validZip || !snapshot.package.requiredPartsPresent || materialDiagnostics.length > 0) {
    throw new GoogleAdapterError("Google Drive XLSX export did not produce a structurally valid workbook", { code: "invalid_export_response" });
  }
  return { bytes, snapshot };
}

export function mergeGoogleExportSnapshot(apiSnapshot, exportedSnapshot) {
  const exportedSheets = new Map((exportedSnapshot?.workbook?.sheets || []).map((sheet) => [sheet.name, sheet]));
  const sheets = (apiSnapshot?.workbook?.sheets || []).map((apiSheet) => {
    const exportedSheet = exportedSheets.get(apiSheet.name);
    return {
      ...(exportedSheet || {}),
      name: apiSheet.name,
      state: apiSheet.state,
      part: exportedSheet?.part || null,
      features: { ...(apiSheet.features || {}), ...(exportedSheet?.features || {}) },
      cells: apiSheet.cells,
    };
  });
  return {
    package: {
      ...(exportedSnapshot?.package || {}),
      features: {
        ...(exportedSnapshot?.package?.features || {}),
        calculationMode: apiSnapshot?.package?.features?.calculationMode ?? exportedSnapshot?.package?.features?.calculationMode ?? null,
      },
    },
    workbook: {
      sheets,
      namedObjects: exportedSnapshot?.workbook?.namedObjects?.length
        ? exportedSnapshot.workbook.namedObjects
        : apiSnapshot?.workbook?.namedObjects || [],
    },
  };
}

async function deleteRemoteFile(fileId, accessToken, fetchImpl, deadline) {
  await request(fetchImpl, `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: authorization(accessToken),
  }, deadline, { retries: 2 });
}

export function googleSheetsAdapter({
  timeoutMs = 60_000,
  googleCredentialsPath = process.env.SHEETPARITY_GOOGLE_CREDENTIALS,
  googleFolderId = process.env.SHEETPARITY_GOOGLE_TEST_FOLDER_ID,
  googleCredentials = null,
  fetchImpl = globalThis.fetch,
  tokenProvider = null,
  pollMs = 300,
} = {}) {
  return {
    id: "google-sheets",
    label: "Google Sheets",
    kind: "credentialed-service",
    async run(filePath) {
      const started = Date.now();
      if ((!googleCredentialsPath && !googleCredentials && !tokenProvider) || !googleFolderId) return unavailableResult(started);
      if (typeof fetchImpl !== "function") return unavailableResult(started, "Google Sheets requires a Node.js runtime with fetch support");

      const deadline = started + timeoutMs;
      let accessToken = null;
      let remoteFileId = null;
      let imported = null;
      let stabilized = null;
      let exported = null;
      let failure = null;
      let cleanupFailure = null;
      try {
        const credentials = googleCredentials || JSON.parse(await fs.readFile(googleCredentialsPath, "utf8"));
        accessToken = tokenProvider
          ? await tokenProvider({ credentials, deadline })
          : await accessTokenForCredentials(credentials, fetchImpl, deadline);
        imported = await createNativeSpreadsheet(filePath, googleFolderId, accessToken, fetchImpl, deadline);
        remoteFileId = imported.id;
        await triggerCalculation(remoteFileId, accessToken, fetchImpl, deadline);
        stabilized = await readStableSpreadsheet(remoteFileId, accessToken, fetchImpl, deadline, pollMs);
        exported = await exportNativeSpreadsheet(remoteFileId, accessToken, fetchImpl, deadline);
      } catch (error) {
        failure = error instanceof GoogleAdapterError
          ? error
          : new GoogleAdapterError(error?.message || "Google Sheets adapter failed");
      }

      if (remoteFileId && accessToken) {
        try {
          const cleanupDeadline = Math.max(deadline, Date.now() + Math.min(15_000, timeoutMs));
          await deleteRemoteFile(remoteFileId, accessToken, fetchImpl, cleanupDeadline);
        } catch (error) {
          cleanupFailure = error instanceof GoogleAdapterError
            ? error
            : new GoogleAdapterError(error?.message || "Google Drive cleanup failed", { code: "remote_cleanup_failed" });
        }
      }

      if (failure || !stabilized || !exported) {
        const error = failure || new GoogleAdapterError("Google Sheets did not return normalized evidence");
        const diagnostics = [{
          code: error.code || "google_adapter_failed",
          severity: "error",
          material: true,
          status: error.status,
          message: error.message,
        }];
        if (cleanupFailure) diagnostics.push({ code: "remote_cleanup_failed", severity: "error", material: true, message: cleanupFailure.message });
        return {
          id: "google-sheets",
          label: "Google Sheets",
          kind: "credentialed-service",
          version: null,
          status: "error",
          durationMs: Date.now() - started,
          environment: { endpoint: "Google Sheets API v4 / Drive API v3", releaseChannel: "unknown", locale: null, timezone: null, fontPack: null, calculationMode: null },
          open: { outcome: imported ? "accepted" : "rejected", exitCode: null, timedOut: Boolean(error.timedOut), messages: [error.message] },
          proofLayers: { openImport: imported ? "available" : "failed", formulas: "unavailable", cachedValues: "unavailable", recalculatedValues: "unavailable", namedObjects: "unavailable", renders: "unavailable" },
          workbook: { sheets: [], namedObjects: [] },
          diagnostics,
        };
      }

      const diagnostics = [{
        code: "managed_engine_version_unavailable",
        severity: "info",
        material: false,
        message: "Google Sheets does not expose an exact spreadsheet-engine build number through the API; API surfaces are recorded and engine version remains null",
      }, {
        code: "calculation_trigger_applied",
        severity: "info",
        material: false,
        message: "A hidden temporary sheet was added, edited, and removed before two stable reads so recalculation is triggered without changing the retained workbook structure",
      }, {
        code: "xlsx_roundtrip_export_inspected",
        severity: "info",
        material: false,
        sizeBytes: exported.bytes.byteLength,
        sha256: exported.snapshot.sha256,
        message: "The native Google Sheet was exported back to XLSX and inspected for package-level structural loss before remote deletion",
      }];
      if (cleanupFailure) diagnostics.push({ code: "remote_cleanup_failed", severity: "error", material: true, message: cleanupFailure.message });
      const spreadsheet = stabilized.spreadsheet;
      const combinedSnapshot = mergeGoogleExportSnapshot(stabilized.snapshot, exported.snapshot);
      return {
        id: "google-sheets",
        label: "Google Sheets",
        kind: "credentialed-service",
        version: null,
        status: cleanupFailure ? "error" : "available",
        durationMs: Date.now() - started,
        environment: {
          endpoint: "Google Sheets API v4 / Drive API v3",
          releaseChannel: "unknown",
          locale: spreadsheet?.properties?.locale || null,
          timezone: spreadsheet?.properties?.timeZone || null,
          fontPack: "managed_unobservable",
          calculationMode: spreadsheet?.properties?.autoRecalc || null,
          importMimeType: GOOGLE_SHEETS_MIME,
          exportMimeType: XLSX_MIME,
          remoteRetention: cleanupFailure ? "cleanup_failed" : "permanently_deleted",
        },
        open: {
          outcome: "accepted",
          exitCode: null,
          timedOut: false,
          messages: [cleanupFailure ? "Imported and exported a native Google Sheet, but permanent deletion failed" : "Imported as an ephemeral native Google Sheet, triggered recalculation, captured two stable reads, inspected an XLSX round trip, and permanently deleted the remote file"],
        },
        proofLayers: {
          openImport: "available_native_xlsx_import",
          formulas: "available_userEnteredValue",
          cachedValues: "unavailable_after_native_import",
          recalculatedValues: "available_effectiveValue_after_edit_trigger_and_two_stable_reads",
          namedObjects: "available_exported_xlsx_plus_api_named_ranges",
          structures: "available_exported_xlsx_roundtrip",
          renders: "unavailable_not_requested",
        },
        package: combinedSnapshot.package,
        workbook: combinedSnapshot.workbook,
        diagnostics,
      };
    },
  };
}
