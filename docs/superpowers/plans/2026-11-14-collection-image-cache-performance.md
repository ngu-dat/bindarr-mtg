# Collection Image-Cache Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce cumulative service-worker work while scrolling through many unique collection images without losing session-isolated offline image caching.

**Architecture:** Keep the existing Cache Storage layout and the API response-cache path. Add a tested image-prune threshold to the inlined service-worker policy, then track image counts per session and scan/prune image keys only after the 500-image cap has been exceeded by a batch. Concurrent image downloads keep storing independently; concurrent threshold crossings share one trim. Reconcile counts after worker restarts and whenever another cache operation may have changed the image set.

**Tech Stack:** React/Vite frontend, classic service worker generated from `frontend/src/sw/worker.js` and `frontend/src/utils/swPolicy.js`, Node built-in test runner.

---

## File Map

- `frontend/src/utils/swPolicy.js` — define the 32-image prune threshold, predicate, and coalesced trim helper; this module is inlined into the generated classic worker.
- `frontend/src/utils/swPolicy.test.js` — test threshold boundaries, in-flight write accounting, and concurrent trim coalescing; retain existing oldest-first eviction assertions.
- `frontend/src/sw/worker.js` — route successful image responses through a per-session image count; reconcile/prune image keys in batches; coalesce concurrent trims; clear in-memory counts when their cache is deleted or an API cache write can have evicted images.
- `docs/superpowers/specs/2026-11-14-collection-image-cache-performance-design.md` — approved behavior and validation criteria.

### Task 1: Test and add the batch threshold

**Files:**
- Modify: `frontend/src/utils/swPolicy.test.js`
- Modify: `frontend/src/utils/swPolicy.js`

- [ ] **Step 1: Add the failing boundary test**

Import `IMAGE_CACHE_PRUNE_BATCH`, `shouldTrimImageCache`, and `trimImagesWhenNeeded` from `./swPolicy.js`, then append:

```js
test('image cache pruning waits for one batch beyond its cap', () => {
  assert.equal(shouldTrimImageCache(MAX_IMAGES), false);
  assert.equal(shouldTrimImageCache(MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH - 1), false);
  assert.equal(shouldTrimImageCache(MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH), true);
  assert.equal(shouldTrimImageCache(MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH + 1), true);
});

test('image cache trim is coalesced and reconciles writes that land during a scan', async () => {
  const state = { count: MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH, version: 0, trimming: null, reconcileAgain: false };
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
```

- [ ] **Step 2: Run the focused test and confirm it fails on missing exports**

Run from `frontend/`:

```bash
node --test src/utils/swPolicy.test.js
```

Expected: FAIL because `IMAGE_CACHE_PRUNE_BATCH`, `shouldTrimImageCache`, and `trimImagesWhenNeeded` have not been exported yet.

- [ ] **Step 3: Add the pure policy helper**

In `frontend/src/utils/swPolicy.js`, next to `MAX_IMAGES` and `MAX_API`, add:

```js
export const IMAGE_CACHE_PRUNE_BATCH = 32;

export function shouldTrimImageCache(imageCount) {
  return imageCount >= MAX_IMAGES + IMAGE_CACHE_PRUNE_BATCH;
}

export async function trimImagesWhenNeeded(state, reconcile) {
  while (shouldTrimImageCache(state.count) || state.reconcileAgain) {
    if (!state.trimming) {
      const version = state.version;
      state.reconcileAgain = false;
      state.trimming = reconcile()
        .then((count) => {
          const writesDuringScan = state.version - version;
          state.count = count + writesDuringScan;
          state.reconcileAgain = writesDuringScan > 0;
        })
        .finally(() => { state.trimming = null; });
    }
    await state.trimming;
  }
}
```

Keep the exports compatible with `frontend/scripts/swPlugin.mjs`, which inlines exported `const` and `function` declarations into the classic service worker.

- [ ] **Step 4: Run the policy test and confirm it passes**

Run from `frontend/`:

```bash
node --test src/utils/swPolicy.test.js
```

Expected: PASS, including the existing cache-cap and oldest-first `trimPlan` assertions.

### Task 2: Batch image-cache trimming without serializing downloads

**Files:**
- Modify: `frontend/src/sw/worker.js`

- [ ] **Step 1: Add session-keyed image cache state**

Near `currentData`, add:

```js
const imageCacheStates = new Map();
```

Each map key is the existing `dataCacheName` for one authenticated session. Do not put a raw session token in either map.

- [ ] **Step 2: Add image reconciliation, shared initialization, and a coalesced trim**

Add these helpers before `image(req)`:

```js
async function reconcileImages(cache) {
  const urls = (await cache.keys())
    .map((key) => key.url)
    .filter((url) => new URL(url).origin !== self.location.origin);
  const drop = trimPlan(urls, { origin: self.location.origin });
  await Promise.all(drop.map((url) => cache.delete(url)));
  return urls.length - drop.length;
}

async function imageCacheState(name, cache) {
  let state = imageCacheStates.get(name);
  if (!state) {
    state = { count: 0, version: 0, initialized: null, trimming: null, reconcileAgain: false };
    state.initialized = reconcileImages(cache)
      .then((count) => { state.count = count; })
      .catch((error) => {
        imageCacheStates.delete(name);
        throw error;
      });
    imageCacheStates.set(name, state);
  }
  await state.initialized;
  return state;
}

async function storeImage(name, key, response) {
  const cache = await caches.open(name);
  const state = await imageCacheState(name, cache);
  if (loggedOut.has(name)) return;

  await cache.put(key, response);
  if (loggedOut.has(name)) {
    await caches.delete(name);
    imageCacheStates.delete(name);
    return;
  }

  state.count += 1;
  state.version += 1;
  await trimImagesWhenNeeded(state, () => reconcileImages(cache));
}
```

`reconcileImages` receives only cross-origin image URLs, so `trimPlan` applies the 500-image cap without pruning API responses. The first store after a worker restart shares one scan and immediately cleans up any pre-existing over-cap cache. Image downloads and `cache.put()` calls remain concurrent; only a full trim scan is shared while in progress. `version` records writes that complete during a trim; if any land during a scan, `trimImagesWhenNeeded` performs another coalesced reconciliation before those stores finish so the cache returns to its cap.

- [ ] **Step 3: Route cacheable image responses through the new helper**

In `image(req)`, replace `store(name, req.url, res.clone()).catch(() => {});` with:

```js
storeImage(name, req.url, res.clone()).catch(() => {});
```

Keep the network fetch, cache lookup, CORS fallback, and returned response unchanged.

- [ ] **Step 4: Invalidate image counts when existing cache logic can change them**

After the existing API `store(name, key, res)` finishes applying its shared `trimPlan`, invalidate the image count only if an external image was evicted:

```js
if (drop.some(url => new URL(url).origin !== self.location.origin)) {
  imageCacheStates.delete(name);
}
```

In the logout handler, delete the count for the current cache before setting `currentData` to `null`:

```js
if (currentData) {
  loggedOut.add(currentData);
  imageCacheStates.delete(currentData);
}
```

In the logout handler's `staleCaches` deletion callback, also delete each cache's state before deleting that cache.

In the API 401 path, delete the count when deleting that session cache:

```js
imageCacheStates.delete(name);
```

When `store()` deletes other session caches through `staleCaches`, delete each stale cache's state in the same callback that deletes the cache. Keep all cache names session-hashed as they are now.

- [ ] **Step 5: Run the policy suite and frontend build**

Run from `frontend/`:

```bash
npm run test:utils
npm run build
```

Expected: all utility tests pass; Vite emits the generated `dist/sw.js` successfully with the new policy helper inlined.

### Task 3: Run regression checks and the desktop long-scroll comparison

**Files:**
- No additional source files.

- [ ] **Step 1: Run the full frontend checks**

Run from `frontend/`:

```bash
npm test
npm run lint
npm run build
```

Expected: tests, locale checks, lint, and build pass.

- [ ] **Step 2: Compare long-scroll behavior on desktop**

Using the same desktop browser, viewport, and account before and after the change:

1. Open DevTools Performance and record while scrolling through at least 600 distinct card images.
2. Compare long tasks and input/scroll responsiveness; also note service-worker image-cache writes and the Cache Storage image count.
3. Confirm cache count returns to at most 500 after a prune and remains session-scoped.
4. Return to already-seen cards and confirm they still load from cache; log out and confirm the session data cache is removed.

Expected: image-cache key enumeration occurs once per reconciliation/batch instead of once per image, Collection interaction remains responsive over a long scroll, cached images remain reusable, and logout cleanup remains intact.
