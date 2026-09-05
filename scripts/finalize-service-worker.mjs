import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const distDir = resolve('dist');
const serviceWorkerPath = join(distDir, 'service-worker.js');

function portablePath(path) {
  return path.split(sep).join('/');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const template = await readFile(serviceWorkerPath, 'utf8');
if (!template.includes('__PORTFOLIO_CACHE_VERSION__') || !template.includes('/*__PORTFOLIO_PRECACHE__*/ []')) {
  throw new Error('Service worker template placeholders are missing.');
}

const files = await walk(distDir);
const versionedFiles = files
  .map((absolute) => portablePath(relative(distDir, absolute)))
  .filter((path) => path !== 'service-worker.js' && !path.endsWith('.map'))
  .sort();

if (!versionedFiles.includes('index.html')) {
  throw new Error('dist/index.html is missing; cannot build an offline app shell.');
}

const hash = createHash('sha256');
hash.update(template);
for (const path of versionedFiles) {
  hash.update('\0');
  hash.update(path);
  hash.update('\0');
  hash.update(await readFile(join(distDir, path)));
}
const cacheVersion = hash.digest('hex').slice(0, 16);

const precacheRelative = [
  '',
  ...versionedFiles.filter((path) => path !== 'index.html'),
];

const finalized = template
  .replace('__PORTFOLIO_CACHE_VERSION__', cacheVersion)
  .replace('/*__PORTFOLIO_PRECACHE__*/ []', JSON.stringify(precacheRelative, null, 2));

if (finalized.includes('__PORTFOLIO_')) {
  throw new Error('Service worker finalization left an unresolved placeholder.');
}

await writeFile(serviceWorkerPath, finalized, 'utf8');
console.log(`Finalized service worker cache ${cacheVersion} with ${precacheRelative.length} app-shell URL(s).`);
