#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DEFAULT_FOLDER_NAME = "SheetParity Ephemeral Imports";

function usage() {
  console.error("Usage: node scripts/google-oauth-authorize.mjs <desktop-client.json> <authorized-user.json> <env-output>");
  process.exitCode = 2;
}

function apiMessage(payload, fallback) {
  return payload?.error_description || payload?.error?.message || payload?.error || fallback;
}

async function fetchJson(url, init, failureLabel) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${failureLabel}: Google returned a non-JSON response (${response.status})`);
  }
  if (!response.ok) throw new Error(`${failureLabel}: ${apiMessage(payload, `HTTP ${response.status}`)}`);
  return payload;
}

async function writePrivateJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
}

async function writePrivateEnv(filePath, values) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
  const content = Object.entries(values).map(([key, value]) => `${key}=${shellQuote(value)}`).join("\n") + "\n";
  await fs.writeFile(temporary, content, { mode: 0o600 });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
}

async function createOrReuseFolder(accessToken, folderName) {
  const query = new URLSearchParams({
    q: `mimeType='${GOOGLE_FOLDER_MIME}' and name='${folderName.replaceAll("'", "\\'")}' and trashed=false`,
    spaces: "drive",
    fields: "files(id,name,mimeType,trashed)",
    pageSize: "10",
  });
  const listing = await fetchJson(`${DRIVE_FILES_URL}?${query}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  }, "Could not list SheetParity folders");
  const existing = listing.files?.find((file) => file.name === folderName && file.mimeType === GOOGLE_FOLDER_MIME);
  if (existing) return { id: existing.id, reused: true };

  const folder = await fetchJson(`${DRIVE_FILES_URL}?fields=id,name,mimeType`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ name: folderName, mimeType: GOOGLE_FOLDER_MIME }),
  }, "Could not create the SheetParity test folder");
  if (!folder.id || folder.mimeType !== GOOGLE_FOLDER_MIME) throw new Error("Google did not return a Drive folder ID");
  return { id: folder.id, reused: false };
}

async function main() {
  const [clientPathArg, credentialPathArg, envPathArg] = process.argv.slice(2);
  if (!clientPathArg || !credentialPathArg || !envPathArg) return usage();
  const clientPath = path.resolve(clientPathArg);
  const credentialPath = path.resolve(credentialPathArg);
  const envPath = path.resolve(envPathArg);
  const raw = JSON.parse(await fs.readFile(clientPath, "utf8"));
  const client = raw.installed;
  if (!client?.client_id || !client.client_secret) throw new Error("The client JSON must be a Google OAuth Desktop app credential");

  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  let resolveCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname !== "/oauth2/callback") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
      const oauthError = url.searchParams.get("error");
      if (oauthError) throw new Error(`Google authorization failed: ${oauthError}`);
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Google did not return an authorization code");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>SheetParity authorized</title><h1>SheetParity authorization complete</h1><p>You can close this tab. The local setup is continuing.</p>");
      resolveCallback(code);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("SheetParity authorization failed. Return to Codex for details.");
      rejectCallback(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DRIVE_FILE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
    console.log(`authorization_url=${AUTHORIZE_URL}?${params}`);
    console.log("waiting_for_browser_consent=true");

    const code = await callback;
    const token = await fetchJson(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    }, "OAuth token exchange failed");
    if (!token.access_token || !token.refresh_token) throw new Error("Google did not return both access and refresh tokens; revoke prior SheetParity consent and retry");

    const credential = {
      type: "authorized_user",
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: token.refresh_token,
      token_uri: TOKEN_URL,
      scopes: [DRIVE_FILE_SCOPE],
    };
    await writePrivateJson(credentialPath, credential);
    const folder = await createOrReuseFolder(token.access_token, DEFAULT_FOLDER_NAME);
    await writePrivateEnv(envPath, {
      SHEETPARITY_GOOGLE_CREDENTIALS: credentialPath,
      SHEETPARITY_GOOGLE_TEST_FOLDER_ID: folder.id,
    });

    console.log(`credential_path=${credentialPath}`);
    console.log(`environment_path=${envPath}`);
    console.log(`test_folder=${folder.reused ? "reused" : "created"}`);
    console.log("oauth_setup=complete");
  } finally {
    server.close();
  }
}

await main();
