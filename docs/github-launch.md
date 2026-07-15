# GitHub launch package

Canonical public target: `https://github.com/Atomics-hub/sheetparity`.

The initial GitHub launch covers the repository, CI, private vulnerability reporting, and `v0.1.0-alpha.1` release. npm publication, hosted deployment, spending, credentials, and outreach remain separate actions.

## Repository metadata

- Name: `sheetparity`
- Visibility: public, after exact owner/repository approval
- Default branch: `main`
- Description: `CI for generated XLSX files—open, recalculate, and diff workbooks in real spreadsheet engines before customers do.`
- Topics: `xlsx`, `spreadsheet`, `ooxml`, `ci`, `testing`, `libreoffice`, `google-sheets`, `github-actions`, `document-generation`
- License: MIT for code; CC0-1.0 for fixture bytes
- Initial release: `v0.1.0-alpha.1`
- Package publication: none in the first approval; use repository/action installation until a separate npm-name and publication approval

## Included launch surfaces

- five-second terminal demo and exact proof claims in `README.md`;
- executable Node CLI and library exports;
- normalized result JSON Schema;
- real stable LibreOffice adapter and pinned Linux installer;
- credentialed, ephemeral Google Sheets adapter with exported-XLSX structure inspection, mandatory cleanup, and full-corpus live scoring;
- composite GitHub Action and consumer workflow example;
- 68-file provenance and hash-pinned CC0 fixture corpus;
- unit, schema, adapter, and integration tests;
- contribution, security, adapter, hosted-path, research-source, protocol, amendment, and decision documentation;
- structured bug and fixture issue forms plus pull-request checklist;
- canonical falsification scorecard in `evidence/` and raw per-fixture JSON proof in the private handoff outputs.

## Suggested release title

`SheetParity v0.1.0-alpha.1 — catch XLSX engine drift before customers do`

## Suggested release notes

> SheetParity's first developer preview combines always-on OOXML inspection with real LibreOffice 26.2.4 and opt-in Google Sheets execution. The prospectively frozen 68-file matrix detected 20/20 known-bad files, produced 0/20 known-good false positives, repeated with one semantic fingerprint 20/20 times, found 7 qualifying package-well-formed LibreOffice-versus-Google divergences against a requirement of 5, independently reproduced one public silent-value failure, and permanently deleted every successful Google import. Excel Web, OnlyOffice, desktop Excel, native render comparison, and Excel repair-prompt proof remain unavailable or adapter-only.

## Publication decision

Publish the repository as an explicitly scoped alpha. The unchanged technical gate passed in a prospective round. Keep the CLI, local runner, result contract, materiality policy, and public fixture corpus open; reserve managed engine matrices, private fixtures, retained baselines, PR checks, team policies, audit history, zero-retention controls, and user-owned runners for the hosted path.

Do not market the current matrix as Excel validation or universal workbook compatibility. Do not publish npm, deploy a hosted service, spend money, or begin outreach as part of the initial repository push.

## Initial launch sequence

1. Confirm the GitHub owner and exact public repository target.
2. Create public `sheetparity` with no generated template files.
3. Add one reviewed initial commit from the verified launch package and push `main`.
4. Verify `test` and `engine-smoke` on the public runner.
5. Enable private vulnerability reporting and branch protection requiring the verified checks.
6. Create `v0.1.0-alpha.1` and the GitHub release using the notes above.
7. Stop before npm publication, hosted deployment, spending, credentials, or outreach unless separately approved.
