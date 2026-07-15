# Falsification result — 2026-07-15

## Verdict

**Pass. Publish as an explicitly scoped developer preview.**

The prospectively frozen third matrix ran against stable LibreOffice and the real Google Sheets import/recalculation path. It passed every unchanged dossier threshold: known-bad detection, known-good noise, repeated-run stability, local semantic divergence, independent real-engine divergence, the public silent-value fixture, and remote cleanup.

This supports SheetParity's XLSX-only thesis. It does not claim Excel parity, render parity, or coverage of every workbook feature.

Scored engines:

- `LibreOffice 26.2.4.2 0229ac93fcf0d7cbc6376066c6f35021cef002dc`, stable release, controlled `C` locale and `UTC` timezone.
- Google Sheets through Sheets API v4 and Drive API v3, `en_US` locale and `America/Los_Angeles` timezone. Google does not expose an engine build number through these APIs, so the normalized version is truthfully `null`.

Frozen population: 20 known-bad fixtures, 20 known-good controls, 28 exploratory fixtures, and 20 repeated runs. Manifest SHA-256: `f4b01e5fc08a0345e050b21ae921986becb1d69155367ef92c6f8f964f1fbd2b`.

## Scorecard

| Gate | Required | Observed | Result |
|---|---:|---:|---|
| Known-bad detection | at least 16 / 20 | 20 / 20 | pass |
| Known-good false positives | below 10% | 0 / 20 (0%) | pass |
| Repeated normalized stability | at least 19 / 20 | 20 / 20 | pass |
| Well-formed local semantic divergences | at least 5 | 6 | pass, local scope only |
| Independent real-engine divergences | at least 5 | 7 | pass |
| Public silent-value fixture | at least 1 | 1 | pass |
| Remote cleanup failures | exactly 0 | 0 | pass |

Google completed 81 available runs and returned seven expected errors on corrupt inputs. LibreOffice completed 83 available runs and returned five expected errors on corrupt inputs. Neither adapter was unavailable. Every successfully imported Google workbook was permanently deleted.

## Seven qualifying independent-engine fixtures

All seven source packages are well-formed and produced a material LibreOffice-versus-Google disagreement:

1. `explore-07-array-formula`: LibreOffice exposed `F4*2`; Google normalized it to `ARRAY_CONSTRAIN(ARRAYFORMULA(F4*2), 1, 1)`.
2. `explore-11-exceljs-1325-header-footer`: LibreOffice preserved four meaningful header/footer fields; Google's exported XLSX preserved two.
3. `explore-12-exceljs-685-sheet-protection`: LibreOffice preserved sheet protection; Google's exported XLSX did not.
4. `explore-19-openxml-custom-property`: LibreOffice preserved one OOXML custom property; Google's exported XLSX preserved none.
5. `explore-20-exceljs-print-area`: LibreOffice preserved `_xlnm.Print_Area`; Google lost it on import/export.
6. `explore-26-excel-rri-formula`: LibreOffice recalculated the RRI cells to `#NAME?`; Google calculated numeric results.
7. `explore-27-excel-pduration-formula`: LibreOffice recalculated the PDURATION cells to `#NAME?`; Google calculated numeric results.

The structural results come from inspecting Google's exported XLSX, not from pretending the Sheets API exposes OOXML package parts directly.

## Public silent-value proof

`explore-08-phpspreadsheet-1281-decimal-comma.xlsx` is a locally authored CC0 reproduction of [PhpSpreadsheet issue #1281](https://github.com/PHPOffice/PhpSpreadsheet/issues/1281). The source contains malformed numeric payload `1.1.0`.

- LibreOffice repaired `Report!C4` to numeric `1.1`.
- Google Sheets silently lost `Report!C4`.
- Dependent values consequently diverged: `Report!D4` was `33` versus `0`, and `Report!D7` was `111` versus `78`.

This passes the separately specified public silent-value gate. Because the source numeric lexical value is malformed, the fixture is intentionally excluded from the seven package-well-formed divergence files.

## Audit trail

The project did not retroactively rewrite a failed test:

- Round one found 3/5 qualifying independent-engine files and remained failed.
- A post-test formula battery was discovery evidence only; it was not split into artificial fixtures to change round one's result.
- Round two froze six new, independently motivated fixtures. It still found 3/5 and exposed one nondeterministic fingerprint caused by managed XLSX export bytes. All 20 statuses were semantically identical; the round nevertheless remained failed.
- The fingerprint was narrowed to semantic evidence, with regression tests. Round two's saved result was not changed.
- Round three prospectively froze 12 new fixtures, the 68-file manifest, and the original thresholds before engine execution. Pre-matrix corrections to inactive protection metadata and incidental landscape defaults were documented without changing the population, manifest, or thresholds.
- The full frozen third matrix then passed at 7/5.

Protocol, amendments, and stability evidence are retained in `docs/` and `evidence/` so the sequence can be audited.

## Publication decision

The repository deserves publication as `v0.1.0-alpha.1`, with three boundaries prominent:

1. The implemented real-engine matrix is LibreOffice plus opt-in, credentialed Google Sheets.
2. Excel Web, OnlyOffice, desktop Excel, and user-owned desktop runners are adapter boundaries, not implemented validators.
3. Render comparison and native Excel repair-prompt proof remain unavailable and are labeled that way in results.

The evidence supports a useful open-source CI tool and a credible hosted path around managed engine execution, private fixtures, retained baselines, pull-request checks, team policy, audit history, and user-owned runners. It does not support calling the current matrix universal spreadsheet parity.

Machine-readable evidence: `evidence/falsification-scorecard-2026-07-15.json`.
