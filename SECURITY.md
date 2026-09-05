# Security and privacy model

Portfolio Dashboard processes financial exports and therefore treats imported data as sensitive.

## Data that must never be committed

- Trade Republic Net Worth PDFs;
- transaction export CSVs;
- portfolio backups;
- positions and quantities tied to a user;
- transaction history;
- portfolio NAV / P&L snapshots tied to a user;
- user-defined rebalancing targets;
- API keys or secrets.

## Application rules

- Personal files are selected explicitly by the user, either individually or through the local folder picker.
- PDF/CSV bytes and the normalized transaction ledger are processed in browser memory and are not persisted by the application.
- Folder refresh computes SHA-256 fingerprints locally to detect unchanged source pairs. Only the combined fingerprint is stored in local browser storage; file contents and names are not persisted by this mechanism.
- Derived snapshot persistence is opt-in and local to IndexedDB on the current browser/device.
- User-defined main-portfolio rebalancing targets are also opt-in and stored only in local browser storage on the current device. They are never sent to the market proxy and can be erased from the Rebalancing module.
- Rebalancing targets are not currently included in the versioned snapshot JSON backup; browser storage remains the only copy unless the user records them elsewhere.
- The user can export a versioned JSON backup, import it, or erase all local snapshot data explicitly.
- Exported backup files are sensitive personal financial data and must not be committed to this repository.
- No analytics, trackers or third-party scripts are allowed.
- No user-derived string is rendered through `innerHTML`.
- External market access is limited to the reviewed Cloudflare benchmark proxy.
- A market endpoint must never receive portfolio quantities, values, transaction rows, imported files or user-defined target weights.

## Market-data secret boundary

The browser never receives the EODHD API token. Production benchmark requests are routed through the restricted Cloudflare Worker under `worker/`.

The Worker:

- stores `EODHD_API_TOKEN` only as a Cloudflare runtime secret;
- accepts only the public benchmark IDs `msci-world` and `sp500`;
- maps them internally to `EUNL.XETRA` and `SXR8.XETRA`;
- accepts only a bounded public date range;
- returns only sanitized date/adjusted-close rows;
- restricts browser CORS to `https://alanb3110.github.io`;
- has no route or schema capable of accepting portfolio payloads.

The PWA Content Security Policy allows market connections only to `https://portfolio-market-proxy.alan-boulard.workers.dev`; direct browser access to EODHD is not part of the production application.

## Storage limitations

IndexedDB and local browser storage improve continuity but are not guaranteed backups. Browser storage can be cleared by the user, the OS or browser storage management. The explicit JSON export is the recovery mechanism for historical snapshots only; rebalancing targets are a separate local setting and are not yet part of that backup.

## Public repository

The repository is intentionally safe to keep public because it contains only application code, methodology, public identifiers and synthetic fixtures. Public visibility is not a substitute for the rules above: secrets and personal data must never enter Git history.