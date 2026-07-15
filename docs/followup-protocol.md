# Prospective follow-up protocol — round two

Frozen before engine execution on 2026-07-15.

## Purpose

Round one failed the independent-engine gate. This follow-up tests whether broader package-level evidence and six independently motivated structural fixtures establish at least five package-well-formed LibreOffice-versus-Google divergences without weakening the original quality thresholds.

The follow-up fixtures are not splits of the post-test formula battery. All six remain in the population regardless of their result.

## Frozen implementation

- Google Sheets values come from `userEnteredValue` and calculated `effectiveValue` after a reversible edit trigger and two stable reads.
- The native Google Sheet is exported back to XLSX and statically inspected before permanent deletion.
- Pairwise engine comparison is symmetric for sheets, named objects, package counts, and normalized worksheet structures.
- Worksheet evidence covers merges, conditional formats, data validations, headers/footers, ignored errors, manual row/column breaks, row outline depth, sheet protection, table parts, hyperlinks, and autofilter presence.
- LibreOffice remains the official stable 26.2.4.2 build. Google Sheets remains version-honest with `version: null` because the API exposes no engine build.

## Frozen population

- 20 known-good controls;
- 20 known-bad fixtures;
- 16 exploratory fixtures, including the six round-two additions;
- 20 repeated runs of `good-01-basic-arithmetic`.

Round-two additions:

1. `explore-11-exceljs-1325-header-footer`
2. `explore-12-exceljs-685-sheet-protection`
3. `explore-13-exceljs-2069-long-data-validation`
4. `explore-14-synthetic-page-breaks`
5. `explore-15-synthetic-ignored-errors`
6. `explore-16-synthetic-row-outline`

The first three reproduce feature shapes from public ExcelJS reports. The remaining three are synthetic generator-oriented structural edges. All bytes are locally authored and CC0-1.0.

## Frozen thresholds

| Gate | Requirement |
|---|---:|
| Known-bad detection | at least 16/20 |
| Known-good false positives | below 10% |
| Repeated normalized stability | at least 19/20 |
| Package-valid local semantic divergences | at least 5 |
| Package-valid independent real-engine divergences | at least 5 files |
| Public issue-derived silent-value fixture | at least 1 |
| Remote cleanup failures | exactly 0 |

The dossier technical gate passes only if every row passes. No failure may be relabeled as an unavailable proof layer after execution.

## Pre-matrix implementation correction

The first targeted engine exposure found that LibreOffice writes empty `oddHeader` and `oddFooter` elements into otherwise header-free XLSX files. SheetParity initially counted XML element presence rather than non-empty content, which produced false pairwise differences against Google Sheets exports that omit the empty elements.

Before running the complete population, the counter was narrowed to non-empty trimmed header/footer content. The population, fixture bytes, manifest hash, and thresholds remain unchanged. The targeted fixtures and full population must be rerun; the discarded pre-correction outputs do not count toward any gate. The machine-readable amendment is `evidence/followup-amendment-2026-07-15.json`.

## Integrity lock

The frozen `fixtures/manifest.json` SHA-256 is `40a4d19105f7c9e3cabc8f27ce53229f2dc014d4b747471aaff5f454f941fa92`.

The harness must run with:

```bash
SHEETPARITY_PROTOCOL_MANIFEST_SHA256=40a4d19105f7c9e3cabc8f27ce53229f2dc014d4b747471aaff5f454f941fa92
```

Any manifest change invalidates the round and requires a newly declared protocol before engine execution.

## Decision rule

- If every gate passes, prepare the public GitHub repository package and request the one external approval for repository creation and push.
- If any gate fails, keep the repository private and report the failed row without changing the population or threshold.

## Post-scorecard stability audit

Round two reported `1/20` fingerprint stability even though all 20 repeat results had `status: pass` and identical normalized workbook evidence. The only repeated change was the byte SHA-256 of Google's exported XLSX ZIP, which is proof metadata rather than semantic result state. The future-round fingerprint now excludes only `sha256` and `sizeBytes` from the non-material `xlsx_roundtrip_export_inspected` diagnostic; saved result files retain both fields.

Round two remains a failed scorecard. The correction must be verified in a newly frozen round and is recorded in `evidence/round-2-stability-audit-2026-07-15.json`.
