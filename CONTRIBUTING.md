# Contributing to SheetParity

SheetParity values reproducible evidence over feature breadth.

## Development

```bash
npm install
npm test
npm run lint
```

Engine integration tests require a stable LibreOffice build and `SHEETPARITY_SOFFICE=/exact/path/to/soffice`.

## Fixture contributions

A fixture pull request must include:

1. the smallest workbook that preserves the behavior;
2. producer library and version;
3. exact engine names and versions observed;
4. expected formula/value/object outcome;
5. license allowing redistribution;
6. provenance URL when derived from a public issue;
7. confirmation that the workbook contains no private, customer, credential, or personal data.

Do not submit a proprietary workbook and do not merely rename an arbitrary attachment. Synthetic reproduction is preferred.

## Adapter contributions

Follow `docs/adapter-contract.md`. A validator is not an engine. Excel Web must be labeled Excel Web. Desktop automation must be licensed, user-owned, and isolated.

## Pull request bar

- unit tests cover normalization and failure behavior;
- known-good controls do not gain false positives;
- known-bad detection is demonstrated;
- JSON remains compatible with the versioned schema or receives an intentional schema-version change;
- documentation names unavailable proof layers.
