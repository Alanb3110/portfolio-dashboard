import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const distDir = resolve('dist');

function portablePath(path) {
  return path.split(sep).join('/');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const [serviceWorker, indexHtml, manifestText] = await Promise.all([
  readFile(join(distDir, 'service-worker.js'), 'utf8'),
  readFile(join(distDir, 'index.html'), 'utf8'),
  readFile(join(distDir, 'manifest.webmanifest'), 'utf8'),
]);

assert.equal(serviceWorker.includes('__PORTFOLIO_'), false, 'service worker still contains build placeholders');
assert.match(serviceWorker, /const CACHE_PREFIX = 'portfolio-dashboard-';/);
assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\)/, 'cache cleanup must remain namespaced');
assert.match(serviceWorker, /new Request\(url, \{ cache: 'reload' \}\)/, 'install should bypass the browser HTTP cache');
assert.match(serviceWorker, /request\.mode === 'navigate'/, 'offline navigation fallback is missing');

const precacheMatch = serviceWorker.match(/const PRECACHE_RELATIVE = (\[[\s\S]*?\]);/);
assert.ok(precacheMatch, 'generated precache manifest is missing');
const precache = JSON.parse(precacheMatch[1]);
assert.ok(Array.isArray(precache));
assert.ok(precache.includes(''), 'the GitHub Pages app root must be precached');
assert.equal(precache.some((path) => path.endsWith('.map')), false, 'source maps must not be precached');

const allDistFiles = (await walk(distDir)).map((absolute) => portablePath(relative(distDir, absolute)));
const requiredStaticFiles = allDistFiles
  .filter((path) => path !== 'index.html' && path !== 'service-worker.js' && !path.endsWith('.map'))
  .sort();
for (const path of requiredStaticFiles) {
  assert.ok(precache.includes(path), `precache is missing ${path}`);
}

const builtAssetsReferencedByHtml = [...indexHtml.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)]
  .map((match) => `assets/${match[1]}`);
for (const path of builtAssetsReferencedByHtml) {
  assert.ok(precache.includes(path), `HTML references an asset not in the offline shell: ${path}`);
}

const manifest = JSON.parse(manifestText);
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.equal(manifest.display, 'standalone');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest needs at least one icon');

const builtJavaScript = allDistFiles.filter((path) => path.startsWith('assets/') && path.endsWith('.js'));
const registrationPresent = (await Promise.all(
  builtJavaScript.map(async (path) => (await readFile(join(distDir, path), 'utf8')).includes('service-worker.js')),
)).some(Boolean);
assert.equal(registrationPresent, true, 'production bundle does not contain service worker registration');

console.log(`PWA smoke test passed: ${precache.length} precached URL(s), ${requiredStaticFiles.length} static file(s) covered.`);
