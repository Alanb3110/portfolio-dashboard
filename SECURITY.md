# Security and privacy model

Portfolio Dashboard processes financial exports and therefore treats imported data as sensitive.

## Data that must never be committed

- Trade Republic Net Worth PDFs;
- transaction export CSVs;
- portfolio backups;
- positions and quantities tied to a user;
- transaction history;
- portfolio NAV / P&L snapshots tied to a user;
- API keys or secrets.

## Application rules

- Personal files are selected explicitly by the user.
- PDF/CSV bytes and the normalized transaction ledger are processed in browser memory and are not persisted by the application.
- Derived snapshot persistence is opt-in and local to IndexedDB on the current browser/device.
- The user can export a versioned JSON backup, import it, or erase all local snapshot data explicitly.
- Exported backup files are sensitive personal financial data and must not be committed to this repository.
- No analytics, trackers or third-party scripts are allowed.
- No user-derived string is rendered through `innerHTML`.
- External market access is explicit and limited to reviewed adapters.
- The current Content Security Policy allows connections only to the app origin and `https://eodhd.com` for the opt-in benchmark diagnostic.
- The EODHD diagnostic token is entered by the user, kept in page memory only, and is not written to IndexedDB/localStorage by Portfolio Dashboard.
- The EODHD diagnostic requests only the two fixed public symbols `EUNL.XETRA` and `SXR8.XETRA` over a coarse public date range.
- A market endpoint must never receive portfolio quantities, values, transaction rows or imported files.

## Storage limitations

IndexedDB improves continuity but is not a guaranteed backup. Browser storage can be cleared by the user, the OS or browser storage management. The explicit JSON export is therefore the recovery mechanism for historical snapshots.

## Public repository

The repository is intentionally safe to keep public because it contains only application code, methodology, public identifiers and synthetic fixtures. Public visibility is not a substitute for the rules above: secrets and personal data must never enter Git history.
