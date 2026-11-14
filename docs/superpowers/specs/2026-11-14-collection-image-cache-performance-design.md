# Collection image-cache performance design

## Problem

On desktop, scrolling through Collection makes the UI feel progressively slower. Leaving Collection restores responsiveness. The reported symptom is interaction jank, not slow image arrival.

The collection grid is virtualized, so the number of mounted card tiles is bounded. The production service worker caches cross-origin card images per signed-in session, up to `MAX_IMAGES = 500`. Its shared `store()` path currently calls `cache.keys()` and computes the trim plan after every successful image or API cache write. Scrolling through many distinct cards therefore causes repeated cache enumeration and eviction checks. This is a plausible cumulative cost, but it has not yet been confirmed with a browser performance trace.

## Design

Batch image-cache maintenance while preserving the session-scoped offline image cache and its 500-image target cap.

- Initialize the current image-cache count once per cache/worker lifetime, including cleanup if an existing cache is already over the cap.
- Track successful image cache inserts in memory. Do not enumerate the full Cache Storage key list on every image insert.
- When the tracked count exceeds the cap by a small fixed batch (32 images), enumerate keys once, use the existing oldest-first `trimPlan`, remove excess images, and refresh the tracked count.
- Coalesce concurrent trim requests so a scroll burst cannot launch multiple full-cache scans at once. After a trim completes, re-check if concurrent writes crossed the threshold again.
- Keep API response caching, authentication/session partitioning, logout cleanup, offline fallback behavior, and the existing image eviction order unchanged.

The cap may be exceeded temporarily by at most one batch plus image writes already in flight. A trim restores the cache to the existing 500-image cap. If the service worker restarts, its first image-cache write re-reads the cache and reconciles its count before returning to batched maintenance.

## Alternatives considered

1. **Profile first:** Obtain a desktop browser trace from a long collection scroll and change only the confirmed hotspot. This gives the strongest attribution but requires reproducing the authenticated production session.
2. **Disable service-worker image caching:** This removes Cache Storage write/trim work but sacrifices offline card art and repeat-visit image reuse.
3. **Batch image-cache maintenance (recommended):** Reduces repeated cache enumeration while preserving offline behavior and appearance. The improvement will be checked with a repeatable long-scroll comparison; if it does not improve interaction responsiveness, investigate the separately observed continuously animated foil overlays next.

## Validation

- Unit-test cache accounting and pruning: no scan for every insert, over-cap caches trim to 500 oldest-first, worker restart reconciles existing entries, and concurrent threshold crossings coalesce safely.
- Run the existing service-worker policy tests and frontend lint/build checks.
- Compare a long desktop collection scroll before and after using the same browser, viewport, and collection size. Record interaction/scroll responsiveness and service-worker cache maintenance activity; do not treat image download time alone as success.
- Confirm repeated visits still serve cached images and that logout still removes the session-scoped image cache.

## Scope boundaries

This change does not alter card-image URLs or quality, foil appearance, collection data loading, the cache's session isolation, or the offline-image feature. If profiling still shows jank after batching, foil animation cost will be investigated as a separate change.
