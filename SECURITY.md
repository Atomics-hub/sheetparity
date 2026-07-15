# Security policy

SheetParity processes workbook content locally by default. The LibreOffice adapter uses a fresh temporary directory and profile for each run, then removes them after normalization.

Workbooks are untrusted ZIP/XML inputs. Please report ZIP traversal, resource exhaustion, unsafe external-link behavior, macro execution, temporary-file retention, or command-injection issues through [GitHub private vulnerability reporting](https://github.com/Atomics-hub/sheetparity/security/advisories/new). Do not include exploit workbooks or sensitive data in a public issue.

The default LibreOffice lane does not upload files or use cloud credentials. The opt-in Google Sheets lane uploads a workbook only when `google-sheets` is explicitly named in the matrix, converts it inside the configured isolated folder, captures evidence, and permanently deletes the remote file. Cleanup failure is a material test failure.

Google credentials must be named explicitly with `SHEETPARITY_GOOGLE_CREDENTIALS`; ambient Application Default Credentials and browser cookies are ignored at runtime. The personal-account flow requests only Google's per-file `drive.file` scope. Keep service-account keys, OAuth client files, refresh tokens, and generated environment files outside the repository with owner-only permissions, and revoke or rotate them after an experiment when they are no longer needed.

SheetParity does not execute macros embedded in tested workbooks. Its own LibreOffice recalculation macro lives in the isolated temporary profile and accepts only generated file URLs.
