# Changelog

## Unreleased

## 0.1.0-alpha.2 — 2026-07-15

- Publish the first npm distribution under the `next` tag with explicit repository, homepage, issue tracker, registry, and public-access metadata.
- Document project-local and global npm installation while keeping the prerelease status explicit.

## 0.1.0-alpha.1 — 2026-07-15

- Add a Google Sheets adapter with explicit service-account/Shared Drive and authorized-user/personal Drive credential paths, native XLSX import, a reversible edit trigger, two-read formula/effective-value stabilization, observable structure normalization, and mandatory permanent cleanup.
- Limit Google authorization to the recommended, non-sensitive `drive.file` scope; no account-wide spreadsheet-read permission or ambient browser state is used at runtime.
- Add pairwise engine comparisons to the normalized JSON, terminal report, HTML report, fingerprint, and falsification scorecard.
- Inspect the Google-imported workbook's exported XLSX so pairwise comparisons include preserved and lost names, properties, protection, page setup, headers/footers, and related package structure.
- Make semantic fingerprints ignore nondeterministic managed-export diagnostic bytes while retaining engine outcomes, workbook semantics, and material comparisons.
- Add a synthetic formula battery generator for discovering and minimizing real cross-engine semantic differences.
- Expand the synthetic CC0 corpus to 68 files and prospectively freeze a third proof round covering workbook metadata, print settings, views, notes, calculation mode, and formula compatibility.
- Pass the unchanged dossier technical gate: 20/20 known-bad detections, 0/20 known-good false positives, 20/20 stable repeats, 7/5 package-well-formed independent-engine divergences, 1/1 public silent-value proof, and zero remote cleanup failures.
- Preserve GitHub job summaries on expected SheetParity failures while returning the original failing exit code.

- Always-on static XLSX package inspection.
- Isolated LibreOffice adapter with explicit `calculateAll()` and stable-version capture.
- Formula, cached/recalculated value, error, named-object, and structural normalization.
- Materiality rules with canonical engine serialization handling.
- Human terminal, JSON Schema, deterministic fingerprint, and standalone HTML reports.
- Composite GitHub Action with checksum-pinned LibreOffice 26.2.4 Linux installer.
- Initial fifty-file CC0 fixture corpus with provenance and SHA-256 manifest.
- Full 20 known-good, 20 known-bad, and 20-repeat falsification harness.

Excel Web, OnlyOffice, desktop Excel, and render comparison remain adapter-only or unavailable. Google Sheets is implemented and live-scored. Historical failed rounds and the superseding prospective pass are preserved in `docs/decision-log.md` and `docs/falsification.md`.
