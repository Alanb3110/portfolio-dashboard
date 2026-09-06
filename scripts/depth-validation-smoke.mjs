import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import ts from 'typescript';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
const moduleSrc = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1]
  ?? html.match(/<script[^>]+src="([^"]+\.js)"[^>]+type="module"/)?.[1];
assert.ok(moduleSrc, 'Built index.html must reference the application module bundle.');
const assetPath = path.join(distDir, 'assets', path.basename(moduleSrc));
await fs.access(assetPath);

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function syntheticSnapshot(index, total = 100) {
  const date = new Date('2025-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index * 3);
  const snapshotDate = date.toISOString().slice(0, 10);
  const mainValue = 1000 + index * 11 + (index % 5) * 13;
  const ct = mainValue * 0.4;
  const pea = mainValue - ct;
  return {
    schemaVersion: 2,
    methodologyVersion: '5.1',
    sourceFingerprint: `synthetic-depth-${index + 1}/${total}`,
    ledgerFirstDate: '2025-01-01',
    ledgerLastDate: snapshotDate,
    ledgerCutoffDate: snapshotDate,
    snapshotDate,
    savedAt: `${snapshotDate}T12:00:00.000Z`,
    mainValue,
    extendedInvestedValue: mainValue,
    totalNetWorth: mainValue,
    simpleEconomicPnl: mainValue - 1000,
    mainXirr: null,
    summary: {
      compteTitres: ct,
      pea,
      crypto: 0,
      nonCote: 0,
      cash: 0,
      total: mainValue,
    },
    mainPositions: [
      {
        id: 'Compte-titres:SYNTH-CT',
        name: 'Synthetic CT',
        symbol: 'SYNTH-CT',
        pocket: 'Compte-titres',
        value: ct,
        weight: 0.4,
      },
      {
        id: 'PEA:SYNTH-PEA',
        name: 'Synthetic PEA',
        symbol: 'SYNTH-PEA',
        pocket: 'PEA',
        value: pea,
        weight: 0.6,
      },
    ],
    benchmarkCheckpoints: {},
  };
}

async function importHistorySource() {
  const source = await fs.readFile(path.join(root, 'src', 'history.ts'), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
    fileName: 'history.ts',
  }).outputText;
  const tempPath = path.join(root, '.depth-history.mjs');
  await fs.writeFile(tempPath, transpiled, 'utf8');
  const module = await import(`${pathToFileURL(tempPath).href}?depth=${Date.now()}`);
  await fs.rm(tempPath, { force: true });
  return module;
}

const history = await importHistorySource();

// J — isolated IndexedDB lifecycle using the production history module.
await history.eraseHistorySnapshots();
const first = syntheticSnapshot(0, 2);
await history.saveHistorySnapshot(first);
let loaded = await history.loadHistorySnapshots();
assert.equal(loaded.length, 1, 'save must persist one derived snapshot.');

const overwritten = {
  ...first,
  savedAt: '2025-01-01T13:00:00.000Z',
  mainValue: 1111,
  extendedInvestedValue: 1111,
  totalNetWorth: 1111,
  simpleEconomicPnl: 111,
  summary: { ...first.summary, compteTitres: 444.4, pea: 666.6, total: 1111 },
  mainPositions: [
    { ...first.mainPositions[0], value: 444.4, weight: 0.4 },
    { ...first.mainPositions[1], value: 666.6, weight: 0.6 },
  ],
};
await history.saveHistorySnapshot(overwritten);
loaded = await history.loadHistorySnapshots();
assert.equal(loaded.length, 1, 'overwrite on the same date must not create a duplicate.');
assert.equal(loaded[0].mainValue, 1111, 'same-date save must replace the snapshot payload.');

const second = syntheticSnapshot(1, 2);
await history.saveHistorySnapshot(second);
loaded = await history.loadHistorySnapshots();
assert.deepEqual(
  loaded.map((item) => item.snapshotDate),
  [overwritten.snapshotDate, second.snapshotDate],
  'reload must preserve stable chronological order.',
);

const backup = history.buildHistoryBackup(loaded, '2026-09-06T12:00:00.000Z');
const parsedBackup = history.parseHistoryBackup(JSON.stringify(backup));
assert.equal(parsedBackup.snapshots.length, 2, 'exported backup must round-trip deterministically.');
await history.eraseHistorySnapshots();
assert.equal((await history.loadHistorySnapshots()).length, 0, 'erase must clear the isolated database.');
await history.importHistorySnapshots(parsedBackup.snapshots);
loaded = await history.loadHistorySnapshots();
assert.equal(loaded.length, 2, 'backup import must restore both dates.');
for (const record of loaded) {
  for (const forbiddenKey of ['transactions', 'ledger', 'csv', 'pdf', 'sourceFiles', 'rawSource']) {
    assert.equal(Object.prototype.hasOwnProperty.call(record, forbiddenKey), false, `history must not persist ${forbiddenKey}.`);
  }
}
await history.eraseHistorySnapshots();

// K — seed a 100-snapshot isolated history through production import logic.
const volumeSnapshots = Array.from({ length: 100 }, (_, index) => syntheticSnapshot(index));
const imported = await history.importHistorySnapshots(volumeSnapshots);
assert.equal(imported.length, 100, '100 synthetic snapshots must import without loss.');
loaded = await history.loadHistorySnapshots();
assert.equal(loaded.length, 100, '100 snapshots must reload from IndexedDB.');
assert.equal(loaded[0].snapshotDate, volumeSnapshots[0].snapshotDate);
assert.equal(loaded.at(-1).snapshotDate, volumeSnapshots.at(-1).snapshotDate);

let indexedDbOpenCount = 0;
const nativeOpen = indexedDB.open.bind(indexedDB);
Object.defineProperty(indexedDB, 'open', {
  configurable: true,
  value: (...args) => {
    indexedDbOpenCount += 1;
    return nativeOpen(...args);
  },
});

let mutationCallbackCount = 0;
let mutationObserverCount = 0;

function installDom() {
  const dom = new JSDOM(html, {
    url: 'https://alanb3110.github.io/portfolio-dashboard/?depth-validation=1',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const NativeMutationObserver = window.MutationObserver;
  class CountingMutationObserver {
    constructor(callback) {
      mutationObserverCount += 1;
      this.inner = new NativeMutationObserver((records) => {
        mutationCallbackCount += 1;
        callback(records, this);
      });
    }
    observe(...args) { return this.inner.observe(...args); }
    disconnect() { return this.inner.disconnect(); }
    takeRecords() { return this.inner.takeRecords(); }
  }
  Object.defineProperty(window, 'MutationObserver', { value: CountingMutationObserver, configurable: true });

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLDetailsElement: window.HTMLDetailsElement,
    MutationObserver: CountingMutationObserver,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    File: window.File,
    Blob: window.Blob,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
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

async function settle(ms = 150) {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await Promise.resolve();
}

const dom = installDom();
await import(`${pathToFileURL(assetPath).href}?depth-validation=${Date.now()}`);
await settle(300);
await settle(300);

const document = dom.window.document;
assert.equal(document.querySelectorAll('.history-chart-panel').length, 1, 'history chart panel must mount once.');
assert.equal(document.querySelectorAll('.history-hit-target').length, 100, 'chart must expose exactly one selectable portfolio hit target per snapshot.');
assert.equal(document.querySelectorAll('.history-row').length, 6, 'compact history list must remain capped at six rows.');

const selectedIndex = 49;
const target = document.querySelectorAll('.history-hit-target')[selectedIndex];
assert.ok(target, 'middle history point must be selectable.');
target.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
await settle(50);
assert.match(
  document.querySelector('.history-touch-detail')?.textContent ?? '',
  new RegExp(volumeSnapshots[selectedIndex].snapshotDate),
  'selecting a point must show that exact observed snapshot date.',
);

const nodeCount = document.querySelectorAll('*').length;
assert.ok(nodeCount < 2000, `100-snapshot DOM must remain bounded; observed ${nodeCount} nodes.`);
assert.ok(mutationObserverCount < 20, `observer count must remain bounded; observed ${mutationObserverCount}.`);

// L — after stabilization, no autonomous DOM/IndexedDB churn is allowed.
await settle(150);
const stableMutationCount = mutationCallbackCount;
const stableDbOpenCount = indexedDbOpenCount;
const stableNodeCount = document.querySelectorAll('*').length;
await settle(500);
assert.equal(mutationCallbackCount, stableMutationCount, 'MutationObserver callbacks must stop increasing at idle.');
assert.equal(indexedDbOpenCount, stableDbOpenCount, 'IndexedDB opens must stop increasing at idle.');
assert.equal(document.querySelectorAll('*').length, stableNodeCount, 'DOM node count must remain stable at idle.');

const diagnosticsSource = await fs.readFile(path.join(root, 'src', 'diagnostics.ts'), 'utf8');
assert.match(diagnosticsSource, /get\('diagnostics'\) === '1'/, 'verbose diagnostics must remain explicitly opt-in.');
assert.match(diagnosticsSource, /!DIAGNOSTICS_ENABLED/, 'diagnostic init must retain its normal-mode early return.');
assert.equal(document.querySelector('#technical-diagnostics'), null, 'normal mode must not mount the diagnostic heartbeat panel.');

const mainSource = await fs.readFile(path.join(root, 'src', 'main.ts'), 'utf8');
const folderHandler = mainSource.match(/folderInput\.addEventListener\('change',[\s\S]*?\n}\);\n\nanalyzeButton/);
assert.ok(folderHandler, 'folder refresh handler must be identifiable.');
assert.equal((folderHandler[0].match(/runAnalysis\(/g) ?? []).length, 1, 'folder refresh must launch exactly one analysis pipeline.');
assert.equal((folderHandler[0].match(/persistCurrentSnapshot\(false\)/g) ?? []).length, 1, 'folder refresh must persist without forcing a second render.');

const renderAnalysisBlock = mainSource.match(/function renderAnalysis\([\s\S]*?\n}\n\nfunction rerenderCurrentAnalysis/);
assert.ok(renderAnalysisBlock, 'renderAnalysis block must be identifiable.');
assert.equal(
  (renderAnalysisBlock[0].match(/renderForwardBenchmarkPanel\(/g) ?? []).length,
  1,
  'one analysis render must launch at most one World/S&P benchmark panel pipeline.',
);

dom.window.close();
await history.eraseHistorySnapshots();
console.log(`Depth validation smoke passed: IndexedDB lifecycle, 100-snapshot history, selectable sparse chart, bounded DOM (${nodeCount} nodes), idle stability and single-pass orchestration.`);
