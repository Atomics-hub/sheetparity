# Engine adapter contract

An adapter proves behavior in one named spreadsheet surface. It must not borrow another surface's brand or imply proof it did not collect.

## Required output

Each adapter returns:

- stable `id`, human `label`, and `kind` (`local-engine`, `credentialed-service`, or `byo-runner`);
- exact product version or `null`;
- environment: executable or endpoint identity, release channel, locale, timezone, font source, and calculation mode when observable;
- open/import outcome, exit code, timeout, and bounded messages;
- proof-layer availability for open/import, formulas, cached values, recalculated values, named objects, and renders;
- normalized workbook snapshot and diagnostics.

Adapters run in an isolated temporary workspace. The runner deletes that workspace after normalization. Stable fingerprints exclude operational noise such as durations, temp paths, and raw stdout.

## Implemented

### `libreoffice`

Implemented as a real local engine. It creates a fresh LibreOffice user profile, initializes it, installs a small local Basic macro, opens the XLSX hidden, calls `enableAutomaticCalculation(true)` and `calculateAll()`, exports to XLSX, and normalizes the result. The process has a hard timeout and captures the exact LibreOffice version.

Development, alpha, beta, and release-candidate builds are labeled non-stable. They are feasibility evidence only.

### `google-sheets`

Implemented as a credentialed real engine. It accepts only an explicitly named service-account or authorized-user credential plus a dedicated folder ID; it does not read Application Default Credentials or browser cookies. Service accounts require a Shared Drive. Personal accounts use a Desktop OAuth client whose `drive.file` scope limits the adapter to files it creates or the user explicitly opens with the app. The adapter converts the XLSX to a native Google Sheet, adds/edits/removes a hidden temporary sheet as a reversible recalculation trigger, reads `userEnteredValue` formulas and calculated `effectiveValue` results until two consecutive non-volatile snapshots match, normalizes observable named ranges, tables, charts, pivots, merges, and conditional formatting, and permanently deletes the remote file.

Create and delete calls use Shared Drive support. Cleanup failure is material. The adapter uses only the recommended, non-sensitive `drive.file` scope, which supports Sheets API reads for app-created files without access to every spreadsheet in a user's Drive. Google does not expose an exact spreadsheet-engine build number through these APIs, so `version` remains `null` and the environment records Drive API v3, Sheets API v4, locale, timezone, and recalculation mode.

## Adapter-only boundaries

### `excel-web`

Requires a Microsoft Entra application with `Files.ReadWrite` and a OneDrive for Business or SharePoint test drive. A future adapter must use a non-persistent workbook session, FullRebuild calculation, and label itself **Excel Web**.

### `onlyoffice`

Requires a pinned self-hosted OnlyOffice Document Server and JWT secret, or a user-owned runner. The exact server build must be reported.

### `excel-desktop`

Requires a user-owned Windows runner with a properly licensed Excel installation. Unsupported server-side Office automation is not an acceptable hosted implementation.

## Adding an adapter

1. Minimize credential scope and isolate every test file.
2. Capture exact version and environment before the workbook result.
3. Make timeouts and cleanup failures visible.
4. Populate unavailable proof layers explicitly.
5. Add at least one known-good and one known-bad integration test.
6. Prove repeat stability before enabling CI failure by default.
