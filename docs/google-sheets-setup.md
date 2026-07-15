# Dedicated Google Sheets proof lane

SheetParity does not use ambient browser cookies or Application Default Credentials. The live adapter requires an explicitly named credential and an isolated folder. A Google Workspace deployment should use a service account on a Shared Drive; a personal account can use a Desktop OAuth client with Google's recommended, non-sensitive `drive.file` scope.

## Required external setup

1. Create a dedicated Google Cloud project controlled by the intended owner or organization.
2. Enable **Google Drive API** and **Google Sheets API** in that project.
3. Choose one identity path:
   - **Workspace:** create one service account and add it as **Manager** to a dedicated Shared Drive. Do not grant project-owner, editor, or billing roles.
   - **Personal account:** create a Desktop OAuth client, authorize only `drive.file`, and let `scripts/google-oauth-authorize.mjs` create an app-owned folder.
4. Store all credential JSON outside this repository with owner-only filesystem permissions.
5. Provide the absolute credential path and folder ID through the explicit variables below. Do not use `GOOGLE_APPLICATION_CREDENTIALS`; SheetParity ignores ambient ADC by design.

```bash
export SHEETPARITY_GOOGLE_CREDENTIALS=/absolute/path/sheetparity.credentials.json
export SHEETPARITY_GOOGLE_TEST_FOLDER_ID=dedicated_shared_drive_folder_id
```

The adapter requests only `drive.file`. Google documents that scope as sufficient for Sheets API access to app-created files, so no account-wide spreadsheet-read permission is needed. Drive create and delete calls include Shared Drive support. Every imported XLSX is converted to a native Google Sheet; a hidden temporary sheet is added, edited, and removed to trigger calculation without retaining a structural change; the workbook is then read until two consecutive non-volatile snapshots match and permanently deleted. A cleanup failure is a material test failure.

For a personal account, download a **Desktop app** OAuth client JSON and run:

```bash
node scripts/google-oauth-authorize.mjs \
  /absolute/path/desktop-client.json \
  /absolute/path/sheetparity.oauth.credentials.json \
  /absolute/path/sheetparity.google.env
```

Open the printed URL, review and approve the per-file scope, then load the generated environment file before the smoke test. The helper writes the refresh token and environment file with mode `0600` and creates or reuses only the app-visible `SheetParity Ephemeral Imports` folder.

```bash
set -a
source /absolute/path/sheetparity.google.env
set +a
```

## Smoke test

```bash
node bin/sheetparity.js test fixtures/corpus/good-01-basic-arithmetic.xlsx \
  --matrix google-sheets \
  --timeout 120000 \
  --json work/google-smoke.json
```

The expected engine status is `available`, the environment retention field is `permanently_deleted`, and the dedicated Drive folder is empty after the command.

## Full falsification run

```bash
SHEETPARITY_MATRIX=libreoffice,google-sheets \
SHEETPARITY_SOFFICE=/absolute/path/to/stable/soffice \
SHEETPARITY_REPEAT_COUNT=20 \
SHEETPARITY_PROTOCOL_MANIFEST_SHA256=f4b01e5fc08a0345e050b21ae921986becb1d69155367ef92c6f8f964f1fbd2b \
SHEETPARITY_FALSIFICATION_OUTPUT=outputs/falsification-round-3 \
pnpm run falsify
```

The dossier gate passes only when all existing local thresholds remain green, at least five package-well-formed fixtures produce material LibreOffice-versus-Google disagreement, the public PhpSpreadsheet #1281 candidate independently reproduces a silent value difference, and every successful remote import is permanently deleted. The frozen third-round run passed those gates; implementation alone would not have done so.

## Account boundary

A service account cannot own files in My Drive and therefore needs a Shared Drive. If Shared Drives are unavailable, use the explicit authorized-user route above; do not share an arbitrary personal folder with the service account and mistake that for a working import boundary.
