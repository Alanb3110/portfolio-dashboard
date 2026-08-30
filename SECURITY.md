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
- Foundation v5 processes files in browser memory only.
- No analytics, trackers or third-party scripts are allowed.
- No user-derived string is rendered through `innerHTML`.
- The initial Content Security Policy permits network connections only to the application origin.
- External market access must be introduced through an explicitly reviewed adapter.
- A market endpoint must not accept portfolio quantities, values, transaction rows or files.

## Public repository

The repository is intentionally safe to keep public because it contains only application code, methodology, public identifiers and synthetic fixtures. Public visibility is not a substitute for the rules above: secrets and personal data must never enter Git history.
