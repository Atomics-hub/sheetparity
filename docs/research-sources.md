# Research and fixture sources

SheetParity's corpus is synthetic-first. These sources establish failure shapes and engine boundaries; no third-party workbook attachment is redistributed.

## Public failure reports

- ExcelJS #2778 — an exported autofilter works in Excel but not LibreOffice: <https://github.com/exceljs/exceljs/issues/2778>
- ExcelJS #2896 — image anchoring behaves differently in Google Sheets versus Excel and LibreOffice: <https://github.com/exceljs/exceljs/issues/2896>
- PhpSpreadsheet #1281 — locale-sensitive decimal serialization emits `1.1.0`; the report says LibreOffice repairs it while Google Sheets silently drops it: <https://github.com/PHPOffice/PhpSpreadsheet/issues/1281>
- NPOI #1801 — generated XLSX/DOCX files stopped opening after a version upgrade: <https://github.com/nissl-lab/npoi/issues/1801>

## LibreOffice baseline

- LibreOffice release notes and maintained versions: <https://www.libreoffice.org/release-notes/>
- Official downloads: <https://www.libreoffice.org/download/>
- Development builds are explicitly not recommended for production use: <https://www.libreoffice.org/download-other/>

The scored local run uses official LibreOffice 26.2.4.2. The repository's Linux installer pins the official archive URL and SHA-256.

## Credentialed adapter boundaries

- Microsoft Graph Excel workbook API: <https://learn.microsoft.com/en-us/graph/api/resources/excel>
- Microsoft Graph workbook sessions: <https://learn.microsoft.com/en-us/graph/api/workbook-createsession>
- Microsoft Graph workbook calculation: <https://learn.microsoft.com/en-us/graph/api/workbookapplication-calculate>
- Google Drive uploads and conversion: <https://developers.google.com/workspace/drive/api/guides/manage-uploads>
- Google Sheets values API: <https://developers.google.com/workspace/sheets/api/guides/values>
- Microsoft server-side Office automation considerations: <https://support.microsoft.com/en-us/topic/considerations-for-server-side-automation-of-office-48bcfe93-8a89-47f1-0bce-017433ad79e2>
