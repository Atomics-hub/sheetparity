# Evidence

`falsification-scorecard-2026-07-15.json` is the durable, machine-readable result of the complete LibreOffice + Google Sheets experiment: 50 corpus fixtures and 20 repeated runs.

The canonical scorecard records the prospectively frozen third round, which passed the unchanged dossier gate with 7/5 package-well-formed independent-engine divergence fixtures, 20/20 known-bad detections, 0/20 known-good false positives, 20/20 stable repeats, 1/1 public silent-value proof, and zero remote cleanup failures. Historical failed rounds remain preserved under `outputs/falsification-google/` and `outputs/falsification-round-2/`; their protocol and amendment evidence remains in this directory.

The separately preserved `outputs/falsification-diagnostic-pre-normalization/` run failed the false-positive threshold at 15%. It exposed three non-semantic engine rewrites: boolean constants to `TRUE()`/`FALSE()`, removal of unnecessary simple-sheet quotes, and chart part-path normalization. The final code reports those changes but does not mark them material when values and object counts survive.
