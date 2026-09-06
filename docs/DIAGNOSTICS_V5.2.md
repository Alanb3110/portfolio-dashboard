# v5.2 temporary runtime diagnostics

This instrumentation is intentionally verbose and temporary for real-iPhone validation.

## Goal

Make hangs diagnosable from a screenshot without remote Safari debugging.

## Signals exposed

- every existing UI status transition is copied into a chronological journal;
- timestamps and elapsed time are shown for each entry;
- a one-second JavaScript heartbeat indicates whether the WebKit main event loop is still alive;
- lifecycle events (`visibilitychange`, `pagehide`, `pageshow`, focus/blur) are recorded to diagnose the observed black-screen/background behavior;
- global errors and unhandled promise rejections are recorded;
- selected file metadata are recorded locally (name, size, MIME type, last-modified timestamp, relative path), never file contents;
- service-worker controller/registration state is recorded;
- PDF parsing exposes FileReader events and every asynchronous PDF.js boundary separately.

## Interpretation

If a stage message stops changing but the heartbeat continues, the awaited operation is unresolved while the JS event loop remains alive.

If the heartbeat also stops, WebKit's main event loop is blocked/frozen, so JavaScript timeouts cannot be expected to fire reliably.

The journal is stored only in `sessionStorage` so it can survive a same-session page reload without becoming long-term financial-data persistence.

## Release gate

Do not freeze v5.2 with the verbose diagnostics unless explicitly accepted. Once the iPhone failure is resolved, either remove this instrumentation or hide it behind a local diagnostic toggle while retaining the underlying stage hooks.
