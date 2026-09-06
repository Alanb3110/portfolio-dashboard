import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
const moduleSrc = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1]
  ?? html.match(/<script[^>]+src="([^"]+\.js)"[^>]+type="module"/)?.[1];
assert.ok(moduleSrc, 'Built index.html must reference the application module bundle.');

const assetName = path.basename(moduleSrc);
const assetPath = path.join(distDir, 'assets', assetName);
await fs.access(assetPath);
const builtBundle = await fs.readFile(assetPath, 'utf8');
assert.match(builtBundle, /Orienter le prochain apport/, 'Built production bundle must include the next-contribution planner.');
assert.match(builtBundle, /buy-only/, 'Built production bundle must include explicit buy-only contribution guidance.');
assert.match(builtBundle, /Top 1 ligne/, 'Built production bundle must label concentration explicitly at line level.');
assert.match(builtBundle, /Touchez un point du portefeuille/, 'Built production bundle must include touch guidance for sparse history.');

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function installDom(run) {
  const dom = new JSDOM(html, {
    url: `https://alanb3110.github.io/portfolio-dashboard/?ui-smoke=${run}`,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLDetailsElement: window.HTMLDetailsElement,
    MutationObserver: window.MutationObserver,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    File: window.File,
    Blob: window.Blob,
    localStorage: window.localStorage,
    getComputedStyle: window.getComputedStyle.bind(window),
    crypto: globalThis.crypto ?? webcrypto,
    DOMMatrix: window.DOMMatrix ?? class DOMMatrix {},
    ImageData: window.ImageData ?? class ImageData {},
    Path2D: window.Path2D ?? class Path2D {},
  };
  for (const [key, value] of Object.entries(globals)) setGlobal(key, value);
  window.confirm = () => true;
  return dom;
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await Promise.resolve();
}

async function importBuiltApp(run) {
  const url = `${pathToFileURL(assetPath).href}?ui-smoke=${run}`;
  await import(url);
  await settle();
}

const firstDom = installDom(1);
await importBuiltApp(1);

const firstDocument = firstDom.window.document;
assert.ok(firstDocument.querySelector('.dashboard-shell'), 'Overview enhancer must mount on the built application shell.');
assert.ok(firstDocument.querySelector('.quick-actions'), 'Primary iPhone quick actions must be present.');
assert.equal(firstDocument.querySelectorAll('.utility-drawer').length, 2, 'Import/history secondary controls must be moved into two drawers.');
assert.equal(firstDocument.querySelector('.hero h1')?.textContent, 'Portefeuille');
assert.equal(firstDocument.querySelector('.quick-refresh-button')?.textContent, 'Actualiser et enregistrer');
assert.equal(firstDocument.querySelector('.quick-save-button'), null, 'Manual snapshot save must remain a secondary history action.');
assert.match(firstDocument.body.textContent ?? '', /Enregistrer le snapshot courant/, 'Manual snapshot save must remain available in the history drawer.');

const results = firstDocument.querySelector('.results');
assert.ok(results, 'Results container must exist.');
assert.equal(results.dataset.allocationBound, 'true', 'Allocation UI module must bind to the shared results container.');
assert.equal(results.dataset.rebalancingBound, 'true', 'Rebalancing UI module must bind to the shared results container.');
assert.equal(results.dataset.historyChartBound, 'true', 'History chart UI module must bind to the shared results container.');

await settle();
assert.match(
  firstDocument.body.textContent ?? '',
  /Sources|Historique|Actualiser/,
  'Built DOM should contain the secondary source/history workflow.',
);

const snapshot = {
  schemaVersion: 2,
  methodologyVersion: '5.1',
  sourceFingerprint: 'synthetic-ui-smoke',
  ledgerFirstDate: '2025-01-02',
  ledgerLastDate: '2026-08-27',
  ledgerCutoffDate: '2026-08-27',
  snapshotDate: '2026-08-27',
  savedAt: '2026-08-27T18:00:00.000Z',
  mainValue: 5661.97,
  extendedInvestedValue: 7335.13,
  totalNetWorth: 8332.53,
  simpleEconomicPnl: 100,
  mainXirr: 0.1,
  summary: {
    compteTitres: 726.65,
    pea: 4935.32,
    crypto: 1673.16,
    nonCote: 55.83,
    cash: 941.57,
    total: 8332.53,
  },
  mainPositions: [
    {
      id: 'PEA:FR001400U5Q4',
      name: 'Synthetic World',
      symbol: 'FR001400U5Q4',
      pocket: 'PEA',
      value: 4935.32,
      weight: 4935.32 / 5661.97,
    },
    {
      id: 'Compte-titres:FR0013416716',
      name: 'Synthetic Gold',
      symbol: 'FR0013416716',
      pocket: 'Compte-titres',
      value: 726.65,
      weight: 726.65 / 5661.97,
    },
  ],
  benchmarkCheckpoints: {},
};

const dbRequest = indexedDB.open('portfolio-dashboard-v5', 1);
const db = await new Promise((resolve, reject) => {
  dbRequest.onsuccess = () => resolve(dbRequest.result);
  dbRequest.onerror = () => reject(dbRequest.error);
});
const transaction = db.transaction('snapshots', 'readwrite');
transaction.objectStore('snapshots').put(snapshot);
await new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});
db.close();

const secondDom = installDom(2);
await importBuiltApp(2);
const secondDocument = secondDom.window.document;
const rows = secondDocument.querySelectorAll('.history-row');
assert.equal(rows.length, 1, 'A saved derived snapshot must survive an application reload through IndexedDB.');
assert.match(rows[0]?.textContent ?? '', /2026-08-27/, 'Reloaded local history must expose the stored snapshot date.');
assert.match(secondDocument.body.textContent ?? '', /1 snapshot\(s\) enregistré\(s\) localement/, 'History status must report the persisted snapshot after reload.');

firstDom.window.close();
secondDom.window.close();
console.log('Built UI integration smoke passed: shell composition, contribution planner, line-level concentration, touch-history shipping, module bindings and IndexedDB reload continuity.');
