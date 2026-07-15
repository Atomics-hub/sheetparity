# Decision log

## 2026-07-15 — XLSX only

The initial repository supports `.xlsx` only. DOCX and PPTX have different semantic oracles and remain out of scope until the spreadsheet thesis passes.

## 2026-07-15 — Static inspection is always on

`--matrix` names real engine adapters. Static OOXML inspection always runs and is not presented as an engine.

## 2026-07-15 — LibreOffice is the first scored engine

Excel Web, OnlyOffice, and desktop Excel remain explicit unavailable adapters with credential or runner requirements. Google Sheets has a live adapter supporting a service account in a Shared Drive or an explicitly authorized user in a dedicated personal-Drive folder. The pilot used the authorized-user path after direct approval; the runtime still ignores ambient browser cookies and Application Default Credentials.

## 2026-07-15 — Google Sheets is ephemeral and version-honest

The Google adapter uses native Drive XLSX conversion, a reversible add/edit/remove temporary-sheet trigger, Sheets `userEnteredValue` and calculated `effectiveValue`, two matching reads for non-volatile stability, and permanent deletion. A deletion failure is material. It does not read personal Application Default Credentials. Google does not expose an exact Sheets engine build through the API, so the normalized engine version remains `null`; API surface, locale, timezone, and recalculation mode are recorded.

## 2026-07-15 — Personal Drive uses explicit OAuth, never a service-account fiction

The pilot account has no Shared Drive creation capability. A service account cannot own My Drive files, so sharing an ordinary personal folder with it would not satisfy the import requirement. SheetParity therefore also accepts an explicit authorized-user credential created by a Desktop OAuth flow. It requests only Google's recommended, non-sensitive `drive.file` scope, creates an app-visible ephemeral-import folder, ignores ambient browser state at runtime, and retains the same permanent-deletion failure gate.

## 2026-07-15 — Stable baseline is LibreOffice 26.2.4

The Codex runtime's LibreOfficeDev 26.8 alpha was used only to prove command feasibility. The scored experiment uses the official stable LibreOffice 26.2.4.2 macOS build, SHA-256 `64e0ad05564554eeee639d49b08b20908a38d4722ec95f1620d05c99bcbe9fb1`.

The GitHub Action installer pins the official LibreOffice 26.2.4 Linux x86-64 archive at SHA-256 `810ef197e190d7804a60e0016052c46ff33792303a200fddda9d5216a64b9900`.

## 2026-07-15 — Direct conversion was rejected

A direct XLSX-to-XLSX conversion preserved intentionally stale cached values. It did not prove recalculation. The production adapter instead initializes an isolated profile, invokes `calculateAll()` through a local Basic macro, and exports the recalculated workbook.

## 2026-07-15 — Fingerprints omit operational noise

Timestamps, durations, raw process messages, and temp paths are excluded from the semantic fingerprint. Engine outcomes, exact versions, normalized workbook evidence, materiality rules, and comparisons remain included.

## 2026-07-15 — Fixture provenance is synthetic-first

No third-party workbook attachment was copied. Public issues supply failure shapes and are linked in the manifest. All fixture bytes are locally authored and CC0.

## 2026-07-15 — Historical round one passes local gates but fails the dossier gate

The complete LibreOffice + Google Sheets experiment detected 20/20 known-bad files, produced 1/20 known-good material failures, repeated one identical semantic fingerprint 20/20 times, and found six well-formed source-cache versus LibreOffice recalculation divergences.

The public issue-derived silent-value gate passed: the PhpSpreadsheet #1281 reproduction was repaired to `1.1` by LibreOffice, lost by Google Sheets, and caused downstream value differences. The package-well-formed independent-engine gate failed at 3/5. This round remains recorded as failed even though a later prospective round passed.

## 2026-07-15 — Post-hoc discovery does not rewrite the falsification result

A separate 44-formula workbook produced 19 material LibreOffice-versus-Google differences. It remains one post-test workbook. The project will not split it after observing results merely to manufacture the two missing qualifying fixtures. Any second proof round must define independently motivated fixtures before running the engines and keep the original thresholds unchanged.

## 2026-07-15 — Historical round two remains failed

Six new fixtures were derived from independent public issue shapes and synthetic edge cases, frozen with a manifest hash before the complete matrix, and scored without changing the original thresholds. The round still reached only 3/5 qualifying package-well-formed independent-engine divergences.

Its 20 repeated executions saved 20 different fingerprints even though every run had the same status and the same semantic result. The varying field was a diagnostic SHA-256 and byte count from Google's nondeterministic XLSX serialization. A projection audit collapsed all 20 results to one semantic fingerprint. The implementation now excludes only those nonmaterial managed-export bytes from the semantic fingerprint and has a regression test, but the saved round-two verdict remains failed.

## 2026-07-15 — Google structure proof uses an exported workbook

The Sheets API exposes cells and selected sheet metadata, not an OOXML package. After native Google import and recalculation, SheetParity exports the remote workbook to XLSX, inspects those bytes with the same static parser, merges that structure with API formula/effective-value evidence, and then permanently deletes the remote file. This makes preserved or lost names, properties, protection, page setup, headers/footers, and related package structures observable without mislabeling API metadata as full OOXML proof.

## 2026-07-15 — Pairwise structural additions are source-bound

Spreadsheet engines can emit harmless default metadata during serialization. A pairwise structure present in one engine and absent in another is material only when the frozen source declared that feature. This prevents incidental defaults, such as a generated landscape flag on an otherwise unspecified source, from becoming false positives while still detecting real source-feature loss.

## 2026-07-15 — Prospective round three passes the unchanged gate

Round three froze 12 new fixtures, the 68-file manifest SHA-256 `f4b01e5fc08a0345e050b21ae921986becb1d69155367ef92c6f8f964f1fbd2b`, and the original thresholds before engine execution. A pre-matrix audit corrected inactive workbook-protection metadata and source-unbound page-layout defaults without changing the population, manifest, or thresholds; both the pre-correction and corrected targeted outputs are preserved.

The full LibreOffice + Google Sheets matrix then detected 20/20 known-bad files, produced 0/20 known-good false positives, repeated one semantic fingerprint 20/20 times, found 6 local semantic divergences, found 7/5 qualifying package-well-formed independent-engine divergences, reproduced 1/1 public silent-value case, and had zero cleanup failures. This supersedes the private recommendation for the current build, not the historical round results.

## 2026-07-15 — Publication recommendation is an honest alpha

The repository deserves a public `v0.1.0-alpha.1` launch. The claim remains XLSX CI using always-on static inspection, stable LibreOffice, and opt-in credentialed Google Sheets. Excel Web, OnlyOffice, desktop Excel, render comparison, and native Excel repair-prompt proof remain unavailable or adapter-only. Public launch does not authorize npm publication, a hosted deployment, spending, credentials, or outreach.
