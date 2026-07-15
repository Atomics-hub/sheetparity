# SheetParity fixture corpus

This corpus contains 68 small `.xlsx` files designed for deterministic compatibility testing:

- 20 known-good controls;
- 20 known-bad cases used by the falsification scorecard;
- 28 exploratory cases covering issue-derived and policy-sensitive edges.

`manifest.json` is the source of truth for classification, expected outcome, SHA-256, provenance, and licensing. Every workbook was authored locally from a synthetic SheetParity base. The issue-derived cases reproduce a *failure shape* described in the linked public report; they do not copy attachments or other third-party workbook bytes.

The six `bad-15` through `bad-20` workbooks are well-formed OOXML packages with intentionally stale formula caches. A package validator can accept them, while a controlled spreadsheet-engine round trip recalculates materially different values. These cases prove the local semantic comparison path; they do not by themselves prove disagreement between two independent real engines.

`explore-08-phpspreadsheet-1281-decimal-comma.xlsx` is a locally authored CC0 reproduction of the exact failure shape reported in [PhpSpreadsheet #1281](https://github.com/PHPOffice/PhpSpreadsheet/issues/1281): a decimal value is emitted as the malformed numeric payload `1.1.0`. SheetParity independently reproduced the report in the credentialed matrix: LibreOffice repaired the value to `1.1`, Google Sheets lost it, and downstream formula values diverged. Because the source numeric lexical value is intentionally malformed, it proves the public silent-value case but is excluded from the package-well-formed divergence count.

The six `explore-11` through `explore-16` fixtures are the frozen follow-up set for round two. They cover headers/footers, worksheet protection, a long inline data-validation list, manual page breaks, ignored-error metadata, and row outlines. Their bytes, hashes, classifications, and inclusion rule were fixed before either engine ran. They are not splits of the post-test formula battery.

The twelve `explore-17` through `explore-28` fixtures are the frozen round-three set. They cover very-hidden sheets, workbook protection, custom properties, print areas, landscape page setup, frozen panes, legacy notes, AGGREGATE, FILTERXML, RRI, PDURATION, and manual calculation mode. All twelve remain in the population regardless of outcome; none was exposed to LibreOffice or Google Sheets before the round-three manifest was frozen.

Fixture bytes are dedicated to the public domain under CC0-1.0. Repository code is MIT licensed.

Regenerate adversarial cases and refresh hashes:

```bash
pnpm fixtures
```

The valid bases are generated with the repository's documented authoring workflow; the mutation script only applies named OOXML defects after a valid base exists.
