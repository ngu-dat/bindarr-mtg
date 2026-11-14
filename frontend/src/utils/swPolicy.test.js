import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DATA_PREFIX, SHELL_PREFIX, MAX_API, MAX_IMAGES, IMAGE_CACHE_PRUNE_BATCH, classifyRequest, dataCacheName,
  isCacheableApiPath, isCacheableResponse, shellCacheName, shouldTrimImageCache, staleCaches,
  trimImagesWhenNeeded, trimPlan, userKeyFor,
} from './swPolicy.js';

const origin = 'https://bindarr.local';
const req = (path, extra = {}) => ({
  method: 'GET', url: path.startsWith('http') ? path : origin + path, origin, mode: 'cors', destination: '', ...extra,
});

test('the cache key is per session token, stable, and never the token itself', async () => {
  const a = await userKeyFor('Bearer token-of-alice');
  const b = await userKeyFor('Bearer token-of-bob');
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.equal(await userKeyFor('Bearer token-of-alice'), a, 'same session, same cache');
  assert.notEqual(a, b, 'two accounts never share a cache');
  assert.ok(!dataCacheName(a).includes('alice'));
  assert.equal(await userKeyFor(null), null);
  assert.equal(await userKeyFor('Basic abc'), null);
});

test('authenticated API reads are cached; anonymous, auth, admin and downloads are not', () => {
  const auth = { authorization: 'Bearer t' };
  assert.equal(classifyRequest(req('/api/collection?page=1', auth)), 'api');
  assert.equal(classifyRequest(req('/api/stats', auth)), 'api');
  // Without a token there is no cache to put it in, and no user to key it by.
  assert.equal(classifyRequest(req('/api/collection')), 'bypass');
  for (const p of ['/api/auth/me', '/api/admin/users', '/api/admin/backups/x.db/download',
    '/api/export?format=csv', '/api/shared/abc', '/api/card-art/index', '/api/scan']) {
    assert.equal(classifyRequest(req(p, auth)), 'bypass', p);
    assert.equal(isCacheableApiPath(p), false, p);
  }
  // Writes are never the worker's business.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(classifyRequest(req('/api/collection', { ...auth, method })), 'bypass', method);
  }
});

test('the shell is cached; /ort and /models are left to their own revalidation', () => {
  assert.equal(classifyRequest(req('/', { mode: 'navigate' })), 'navigate');
  assert.equal(classifyRequest(req('/share/abc', { mode: 'navigate' })), 'navigate');
  assert.equal(classifyRequest(req('/assets/index-abc123.js')), 'asset');
  assert.equal(classifyRequest(req('/assets/index-abc123.js.map')), 'bypass');
  assert.equal(classifyRequest(req('/manifest.webmanifest')), 'shell');
  assert.equal(classifyRequest(req('/icons/icon-192.png')), 'shell');
  assert.equal(classifyRequest(req('/ort/ort-wasm-simd-threaded.wasm')), 'bypass');
  assert.equal(classifyRequest(req('/ort/ort-wasm-simd-threaded.mjs')), 'bypass');
  assert.equal(classifyRequest(req('/models/cornelius.onnx')), 'bypass');
  assert.equal(classifyRequest(req('/something-else.txt')), 'bypass');
  // An /api navigation (the OIDC callback) is the server's, not the shell's.
  assert.equal(classifyRequest(req('/api/auth/oidc/callback', { mode: 'navigate' })), 'bypass');
});

test('cross-origin: card images only', () => {
  assert.equal(classifyRequest(req('https://cards.scryfall.io/large/front/a.jpg', { destination: 'image' })), 'image');
  // Riftbound art.
  assert.equal(classifyRequest(req('https://cmsassets.rgpub.io/sanity/images/a.png', { destination: 'image' })), 'image');
  assert.equal(classifyRequest(req('http://insecure.example/a.jpg', { destination: 'image' })), 'bypass');
  assert.equal(classifyRequest(req('https://fonts.gstatic.com/x.woff2', { destination: 'font' })), 'bypass');
  assert.equal(classifyRequest(req('https://api.scryfall.com/cards/x')), 'bypass');
});

test('an old chunk answered with index.html is never cached as that chunk', () => {
  const html = { status: 200, type: 'basic', contentType: 'text/html; charset=UTF-8' };
  const js = { status: 200, type: 'basic', contentType: 'application/javascript' };
  assert.equal(isCacheableResponse('asset', html), false);
  assert.equal(isCacheableResponse('asset', js), true);
  assert.equal(isCacheableResponse('navigate', html), true);
  assert.equal(isCacheableResponse('api', { status: 200, contentType: 'application/json' }), true);
  assert.equal(isCacheableResponse('api', { status: 500, contentType: 'application/json' }), false);
  assert.equal(isCacheableResponse('api', { status: 200, contentType: 'text/csv' }), false);
  assert.equal(isCacheableResponse('image', { status: 0, type: 'opaque' }), true);
  assert.equal(isCacheableResponse('image', { status: 404, type: 'cors' }), false);
});

test('stale caches: other builds on activate, other sessions on write', () => {
  const names = [shellCacheName('1.0-a'), shellCacheName('1.0-b'), dataCacheName('k1'), dataCacheName('k2'), 'unrelated'];
  assert.deepEqual(staleCaches(names, { version: '1.0-b' }), [shellCacheName('1.0-a')]);
  assert.deepEqual(staleCaches(names, { keepDataName: dataCacheName('k2') }), [dataCacheName('k1')]);
  // Logout: every data cache, never the shell, never a cache that is not ours.
  assert.deepEqual(staleCaches(names, { keepDataName: '' }), [dataCacheName('k1'), dataCacheName('k2')]);
  assert.deepEqual(staleCaches(names), []);
  assert.ok(shellCacheName('x').startsWith(SHELL_PREFIX) && dataCacheName('x').startsWith(DATA_PREFIX));
});

test('trim drops the oldest entries past each cap', () => {
  const images = Array.from({ length: MAX_IMAGES + 3 }, (_, i) => `https://cards.scryfall.io/${i}.jpg`);
  const api = Array.from({ length: MAX_API + 1 }, (_, i) => `${origin}/api/collection?page=${i}`);
  const drop = trimPlan([...images, ...api], { origin });
  assert.deepEqual(drop, [...images.slice(0, 3), api[0]]);
  assert.deepEqual(trimPlan(images.slice(0, 5), { origin }), []);
});

test('image cache pruning waits for one batch beyond its cap', () => {
  assert.equal(shouldTrimImageCache(MAX_IMAGES), false);
  assert.equal(shouldTrimImageCache(MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH - 1), false);
  assert.equal(shouldTrimImageCache(MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH), true);
  assert.equal(shouldTrimImageCache(MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH + 1), true);
});

test('image cache trim is coalesced and reconciles writes that land during a scan', async () => {
  const state = { count: MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH, version: 0, trimming: null };
  let scans = 0;
  let finishScan;
  const reconcile = () => {
    scans += 1;
    if (scans > 1) return Promise.resolve(MAX_IMAGES);
    return new Promise((resolve) => { finishScan = resolve; });
  };

  const first = trimImagesWhenNeeded(state, reconcile);
  const second = trimImagesWhenNeeded(state, reconcile);
  assert.equal(scans, 1, 'concurrent requests share a single scan');
  state.count += 1;
  state.version += 1;
  finishScan(MAX_IMAGES);
  await Promise.all([first, second]);

  assert.equal(scans, 2, 'a write during pruning triggers one final reconciliation');
  assert.equal(state.count, MAX_IMAGES, 'the completed reconciliation restores the cap');
});

test('image cache does not scan before a full batch crosses the cap', async () => {
  const state = { count: MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH - 1, version: 0, trimming: null, reconcileAgain: false };
  let scans = 0;
  await trimImagesWhenNeeded(state, async () => { scans += 1; return MAX_IMAGES; });
  assert.equal(scans, 0);
});

test('the policy can be inlined into a classic worker script', () => {
  const src = readFileSync(new URL('./swPolicy.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'sw.js is not a module; the policy cannot import');
  for (const line of src.split('\n').filter(l => l.startsWith('export '))) {
    assert.match(line, /^export (const|function|async function) /, line);
  }
});
