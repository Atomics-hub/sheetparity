# Prospective follow-up protocol — round three

Frozen before engine execution on 2026-07-15.

## Why a third round exists

Round two failed the independent real-engine gate at 3/5. It also exposed a stable-fingerprint defect: non-semantic Google export ZIP hashes changed between runs even though all 20 normalized results passed. Round two remains failed. Round three tests the corrected semantic fingerprint and a broader, independently motivated population without changing the original thresholds.

## Frozen implementation

- Google Sheets evidence combines two stable API reads with an exported-back-to-XLSX structural snapshot before permanent deletion.
- Stable fingerprints retain normalized workbooks, material diagnostics, engine outcomes, versions, proof layers, and comparisons, but exclude only the nondeterministic `sha256` and `sizeBytes` fields from the non-material managed-export diagnostic.
- Header/footer counts include only non-empty trimmed content.
- Pairwise engine comparisons are symmetric.
- New structural evidence covers sheet visibility state, workbook protection, custom properties, print-area defined names, landscape orientation, frozen panes, legacy note/comment parts, and canonical calculation mode.
- LibreOffice remains stable 26.2.4.2. Google Sheets remains version-honest with `version: null`.

## Frozen population

- 20 known-good controls;
- 20 known-bad fixtures;
- 28 exploratory fixtures;
- 20 repeated runs of `good-01-basic-arithmetic`;
- 68 total distinct fixture files.

Round-three additions are `explore-17` through `explore-28`. They were selected from documented Excel/Open XML features and formula families before either engine saw their bytes. All twelve remain in the population regardless of outcome.

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

The technical gate passes only if every row passes. No fixture may be removed, reclassified, or declared unavailable because of its result.

## Integrity lock

The frozen `fixtures/manifest.json` SHA-256 is `f4b01e5fc08a0345e050b21ae921986becb1d69155367ef92c6f8f964f1fbd2b`.

The harness must run with:

```bash
SHEETPARITY_PROTOCOL_MANIFEST_SHA256=f4b01e5fc08a0345e050b21ae921986becb1d69155367ef92c6f8f964f1fbd2b
```

Any manifest change invalidates the round.

## Pre-matrix implementation correction

The targeted exposure found two default-serialization artifacts: LibreOffice emitted a disabled `workbookProtection` element, and Google emitted explicit landscape metadata on source sheets that did not request landscape orientation. Before the full population run, active workbook protection was narrowed to truthy lock flags, and symmetric structural additions were bounded to features declared by the frozen source workbook.

This correction removes incidental false positives. It does not change fixture bytes, population, thresholds, or the manifest hash. All twelve prospectives must be rerun; the first targeted outputs do not count. The machine-readable record is `evidence/round-3-pre-matrix-amendment-2026-07-15.json`.

## Decision rule

- If every gate passes and qualifying fixtures survive individual evidence review, SheetParity earns publication preparation.
- If any gate fails, keep it private and report the failed row without lowering the threshold.
