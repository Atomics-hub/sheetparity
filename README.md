# SheetParity

**CI for generated XLSX files.** SheetParity opens a workbook in named spreadsheet engines, forces recalculation where the engine supports it, and reports material formula, value, error, and structural differences before a customer finds them.

```text
$ sheetparity test report.xlsx --matrix libreoffice
SheetParity FAIL
report.xlsx  sha256:18e2cb9dda66  4078 bytes

Engine               Outcome      Evidence
LibreOffice 26.2.4.2 FAIL         1 material / 1 total differences

Material differences
  Report!D4  libreoffice  value_changed  999 → 75
```

That workbook is a valid OOXML ZIP package. Its formula cache says `999`; LibreOffice recalculates the formula to `75`. A package validator alone cannot expose that difference.

## What exists today

- Static XLSX package inspection: required parts, XML parsing, internal relationships, formula/cached values, errors, sheets, names, tables, charts, drawings, macros, and external-link inventory.
- A real LibreOffice adapter with an isolated user profile, controlled `C` locale and `UTC` timezone, hard timeout, explicit version capture, `calculateAll()`, and XLSX export.
- A credentialed Google Sheets adapter that imports XLSX as a native Sheet in a dedicated folder, performs a reversible edit trigger, captures formulas and calculated effective values after two stable reads, and permanently deletes the remote file.
- Stable normalized JSON with a versioned JSON Schema and a semantic fingerprint that excludes operational timing/path noise and nondeterministic managed-export diagnostic bytes.
- Human terminal output and a standalone HTML report.
- Materiality rules for numeric tolerances, formula/error changes, structural loss, volatile functions, and external references.
- A 68-file CC0 fixture corpus with provenance, hashes, 20 known-good controls, 20 known-bad cases, and 28 prospectively specified exploratory edges.
- A composite GitHub Action plus a pinned LibreOffice 26.2.4 Linux installer.

Excel Web, OnlyOffice, and desktop Excel are **adapter boundaries, not implemented engines**. Google Sheets is implemented and live-scored, but remains opt-in and credential-gated for users. The prospectively frozen third falsification round passed every unchanged technical threshold: 20/20 known-bad detections, 0/20 known-good false positives, 20/20 stable repeats, 7 qualifying package-well-formed LibreOffice-versus-Google divergences against a requirement of 5, one independently reproduced public silent-value failure, and zero remote cleanup failures. SheetParity never calls Excel Web “Excel” and never treats a validator as a spreadsheet engine.

## Install and run locally

Requires Node.js 20+ and a stable LibreOffice installation.

```bash
npm install
node bin/sheetparity.js test fixtures/corpus/good-01-basic-arithmetic.xlsx \
  --matrix libreoffice \
  --json result.json \
  --html report.html
```

If `soffice` is not on `PATH`, pass it explicitly:

```bash
node bin/sheetparity.js test report.xlsx \
  --matrix libreoffice \
  --soffice /path/to/soffice
```

### Google Sheets proof lane

Google Sheets is opt-in. SheetParity accepts an explicitly named service-account credential for a Shared Drive or an explicitly authorized OAuth user credential for a dedicated personal-Drive folder. It deliberately ignores Application Default Credentials and ambient browser cookies.

1. Enable Drive API v3 and Sheets API v4 in a dedicated Google Cloud project.
2. Use either a service account with Manager access to a dedicated Google Workspace Shared Drive, or a Desktop OAuth client authorized with only `drive.file` for a dedicated user-owned folder.
3. Store the resulting credential outside the repository and set the two explicit variables below.

```bash
export SHEETPARITY_GOOGLE_CREDENTIALS=/absolute/path/sheetparity.credentials.json
export SHEETPARITY_GOOGLE_TEST_FOLDER_ID=your_dedicated_folder_id

node bin/sheetparity.js test report.xlsx \
  --matrix libreoffice,google-sheets \
  --soffice /path/to/soffice \
  --timeout 120000 \
  --json result.json
```

The adapter uses only Google's recommended, non-sensitive `drive.file` scope, includes Shared Drive support on create/delete calls, never returns a remote spreadsheet URL, and treats cleanup failure as a material engine error. The scope supports Sheets API reads for app-created files without granting access to every spreadsheet in the user's Drive. Google does not expose an exact spreadsheet-engine build number through these APIs, so `version` is truthfully `null`; the API surfaces, locale, timezone, and calculation mode are recorded instead.

See [`docs/google-sheets-setup.md`](docs/google-sheets-setup.md) for the exact dedicated-project, Shared Drive, smoke-test, and credential requirements.

Exit codes are CI-friendly:

| Code | Meaning |
|---:|---|
| `0` | No material source or engine difference |
| `1` | Material package, open/import, formula, value, error, or structure failure |
| `2` | Usage or internal error |
| `3` | Requested engine matrix is incomplete |

## GitHub Action

After the repository has a public owner and `v0.1.0-alpha.1` tag:

```yaml
- name: Test generated XLSX
  uses: Atomics-hub/sheetparity@v0.1.0-alpha.1
  with:
    file: reports/quarterly-report.xlsx
    matrix: libreoffice
```

The action downloads the official LibreOffice 26.2.4 Linux package, verifies its pinned SHA-256, installs it on an Ubuntu runner, runs SheetParity, and writes the terminal summary to the GitHub job summary. JSON and HTML paths are exposed as action outputs.

## JSON result

Every result identifies:

- source SHA-256 and package evidence;
- exact engine id, kind, version, release channel, locale, timezone, font source, and calculation mode;
- open/import outcome and captured diagnostics;
- formulas, cached/recalculated values, errors, named objects, and structural losses;
- materiality decisions and unavailable proof layers;
- a deterministic semantic fingerprint.

The contract is in [`schemas/result.schema.json`](schemas/result.schema.json). See [`docs/adapter-contract.md`](docs/adapter-contract.md) before implementing another engine.

## Materiality policy

Default policy:

```json
{
  "numericAbsoluteTolerance": 1e-9,
  "numericRelativeTolerance": 1e-9,
  "ignoreVolatileFormulaValues": true,
  "ignoreExternalFormulaValues": true,
  "structuralLossIsMaterial": true,
  "formulaChangeIsMaterial": true,
  "errorChangeIsMaterial": true
}
```

Override it with `--policy policy.json`. Volatile and external formulas remain visible in JSON even when their value changes are non-material.

## Corpus and falsification

The corpus is intentionally small enough to audit. `fixtures/manifest.json` records classification, expected outcome, provenance, license, SHA-256, and whether a fixture is a well-formed package with a semantic divergence.

Run the full local experiment with a stable engine:

```bash
SHEETPARITY_SOFFICE=/path/to/soffice npm run falsify
```

Run the credentialed two-engine experiment only in a dedicated Google test environment:

```bash
SHEETPARITY_MATRIX=libreoffice,google-sheets \
SHEETPARITY_SOFFICE=/path/to/soffice \
SHEETPARITY_GOOGLE_CREDENTIALS=/absolute/path/sheetparity.credentials.json \
SHEETPARITY_GOOGLE_TEST_FOLDER_ID=your_dedicated_folder_id \
npm run falsify
```

The dossier-level gate is stricter than the local experiment. A source cache versus one LibreOffice recalculation is useful local proof, but it is **not** disagreement between two independent real engines. Round one found 3/5 qualifying files. Round two remained at 3/5 and exposed a nondeterministic managed-export fingerprint, which was fixed without changing that round's result. The prospectively frozen 68-file third round passed at 7/5 with 0/20 known-good false positives and 20/20 stable repeats. The complete evidence and publication decision are recorded in [`docs/falsification.md`](docs/falsification.md).

## Honest scope

SheetParity can report what a named engine version did in a controlled environment. It cannot prove behavior across every Office build, device, font set, locale, printer driver, add-in, macro, or external data connection.

Current render comparison is unavailable and labeled as such in every result. Google import/recalculation proof is implemented and was live-scored through a dedicated OAuth test folder; Google still does not expose a precise Sheets engine build number. Native Excel repair prompts also remain unavailable until a properly licensed user-owned runner exists. Desktop Office server automation is not silently substituted.

## Why open source

The CLI, local runner, result model, materiality policy, and public fixture corpus belong in the open. The credible hosted surface is managed Excel Web and Google execution, private fixtures, retained baselines, pull-request checks, team policy, audit history, zero-retention controls, and user-owned runners.

## Contributing

The most valuable contribution is a minimized, redistributable XLSX fixture with exact producer and engine versions. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the fixture provenance rules before opening a pull request.

MIT licensed. Synthetic fixture bytes are CC0-1.0.
