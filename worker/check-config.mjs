import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const nested = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');

function normalize(text, nestedConfig) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^#.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .replace(
      nestedConfig ? 'main = "src/index.js"' : 'main = "worker/src/index.js"',
      'main = "<worker-entry>"',
    )
    .trim();
}

assert.equal(
  normalize(root, false),
  normalize(nested, true),
  'Root and worker Wrangler configurations must stay equivalent.',
);

for (const config of [root, nested]) {
  assert.match(config, /required\s*=\s*\[\s*"EODHD_API_TOKEN"\s*\]/);
  assert.match(config, /name\s*=\s*"MARKET_RATE_LIMITER"/);
  assert.match(config, /ALLOWED_ORIGIN\s*=\s*"https:\/\/alanb3110\.github\.io"/);
}

console.log('Wrangler configuration mirrors are consistent.');
