# GitHub launch package

Canonical public target: `https://github.com/Atomics-hub/sheetparity`.

The initial GitHub launch covered the repository, CI, private vulnerability reporting, and `v0.1.0-alpha.1` release. The approved npm follow-up publishes `0.1.0-alpha.2` under the `next` dist-tag. Hosted deployment, spending, new credentials, and outreach remain separate actions.

## Repository metadata

- Name: `sheetparity`
- Visibility: public, after exact owner/repository approval
- Default branch: `main`
- Description: `CI for generated XLSX files—open, recalculate, and diff workbooks in real spreadsheet engines before customers do.`
- Topics: `xlsx`, `spreadsheet`, `ooxml`, `ci`, `testing`, `libreoffice`, `google-sheets`, `github-actions`, `document-generation`
- License: MIT for code; CC0-1.0 for fixture bytes
- Current prerelease: `v0.1.0-alpha.2`
- Package publication: public npm package `sheetparity@0.1.0-alpha.2` under the `next` dist-tag

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

## npm follow-up release title

`SheetParity v0.1.0-alpha.2 — install SheetParity from npm`

## npm follow-up release notes

> SheetParity is now installable from npm with `npm install --save-dev sheetparity@next` or `npm install --global sheetparity@next`. This prerelease contains the same tested XLSX engine-parity implementation and prospective 7/5 falsification proof, with explicit npm repository, issue, license, and public-access metadata. Excel Web, OnlyOffice, desktop Excel, native render comparison, and Excel repair-prompt proof remain unavailable or adapter-only.

## Publication decision

Publish the repository as an explicitly scoped alpha. The unchanged technical gate passed in a prospective round. Keep the CLI, local runner, result contract, materiality policy, and public fixture corpus open; reserve managed engine matrices, private fixtures, retained baselines, PR checks, team policies, audit history, zero-retention controls, and user-owned runners for the hosted path.

Do not market the current matrix as Excel validation or universal workbook compatibility. npm publication is approved for `0.1.0-alpha.2`; hosted deployment, spending, and outreach remain outside this follow-up.

## Initial launch sequence

1. Confirm the GitHub owner and exact public repository target.
2. Create public `sheetparity` with no generated template files.
3. Add one reviewed initial commit from the verified launch package and push `main`.
4. Verify `test` and `engine-smoke` on the public runner.
5. Enable private vulnerability reporting and branch protection requiring the verified checks.
6. Create `v0.1.0-alpha.1` and its GitHub release.
7. Prepare `v0.1.0-alpha.2`, verify public CI, publish `sheetparity@0.1.0-alpha.2` under `next`, and verify a clean registry install.
8. Stop before hosted deployment, spending, new credentials, or outreach unless separately approved.
