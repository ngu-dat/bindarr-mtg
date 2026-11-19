import { memo, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { onActivateKey } from '../../utils/a11y';
import { getCardDisplayName } from '../../utils/langHelper';
import Price from '../Price';
import { AddSelectedToWishlist } from '../WishlistHeart';
import { useT } from '../../utils/i18n';
import { useFx } from '../../utils/useFx';
import { totalPrices } from '../../utils/convertPrice';
import { priceText } from '../../utils/formatPrice';
import { printingLabel } from '../../utils/cardOptions';

// The running list of cards this session added, newest first, with a count and
// total value — the scanner's record of the run, in place of a toast per card.
// Long-press multi-select and bulk actions as on the collection page. A tile the
// matcher was unsure of carries a "?" and opens its alternatives when tapped.
function RecentScans({
  recentSelect, setRecentScans, recentScans, activateRecent, togglePrinting, showToast,
}) {
  const { t } = useT();
  // Tiles whose finish change is in flight, so a double tap cannot flip twice.
  const [switching, setSwitching] = useState(() => new Set());
  const flip = async (item) => {
    if (switching.has(item.entry_id)) return;
    setSwitching(prev => new Set(prev).add(item.entry_id));
    try { await togglePrinting(item); } finally {
      setSwitching(prev => { const n = new Set(prev); n.delete(item.entry_id); return n; });
    }
  };
  const { fx, currency } = useFx();
  const copies = recentScans.reduce((n, s) => n + (s.quantity || 1), 0);
  const value = useMemo(
    () => totalPrices(recentScans.map(s => ({ amount: (s.price_trend || 0) * (s.quantity || 1), currency: s.price_currency })), currency, fx),
    [recentScans, currency, fx]
  );
  const valueText = value.total != null
    ? priceText(value.total, value.currency)
    : value.subtotals.map(x => priceText(x.amount, x.currency)).join(' + ');
  return (
    <div className="glass-panel" style={{ width: '100%', marginTop: '1rem' }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--text-strong)', marginBottom: '0.85rem', borderLeft: '3px solid var(--accent-red)', paddingLeft: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span>{t('scan.recentScans')}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('scan.sessionSummary', { count: copies, value: valueText })}
          </span>
        </span>
        {recentSelect.selectMode
          ? <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={recentSelect.exitSelectMode}>{t('bulk.done')}</button>
          : <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => setRecentScans([])}>{t('scan.clearHistory')}</button>}
      </h3>

      {/* Bulk action bar (select mode). Same actions/endpoint as the collection page. */}
      {recentSelect.selectMode && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.6rem' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-strong)', fontSize: '0.8rem', marginRight: '0.25rem' }}>{recentSelect.selectedIds.size} selected</span>
          <button className="btn btn-danger" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!recentSelect.selectedIds.size} onClick={() => recentSelect.runBulk('delete', null, t('bulk.confirmDelete', { count: recentSelect.selectedIds.size }))}>{t('bulk.delete')}</button>
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!recentSelect.selectedIds.size} onClick={() => recentSelect.runBulk('trade', null)}>{t('bulk.markTrade')}</button>
          {/* Wants the cards; the copies just scanned stay (Delete is beside it). */}
          <AddSelectedToWishlist
            cardIds={() => recentScans.filter(s => recentSelect.selectedIds.has(s.entry_id)).map(s => s.card_id)}
            showToast={showToast}
            disabled={!recentSelect.selectedIds.size}
            style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}
          />
        </div>
      )}

      {/* Horizontal strip of recent scans, card-shaped like the box tiles.
          Tap = edit; long-press = multi-select (shared with collection page). */}
      <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
        {recentScans.map((item, idx) => {
          const selected = recentSelect.selectMode && recentSelect.selectedIds.has(item.entry_id);
          return (
          <div
            key={item.entry_id ?? idx}
            role="button"
            tabIndex={0}
            aria-pressed={recentSelect.selectMode ? selected : undefined}
            onClick={() => activateRecent(item)}
            onKeyDown={onActivateKey(() => activateRecent(item))}
            {...recentSelect.pressHandlers(item.entry_id)}
            title={t('scan.tapEditHoldSelect')}
            style={{ flex: '0 0 auto', width: '76px', display: 'flex', flexDirection: 'column', gap: '0.25rem', cursor: 'pointer', userSelect: 'none', WebkitTouchCallout: 'none', opacity: recentSelect.selectMode && !selected ? 0.55 : 1 }}
          >
            <div style={{ position: 'relative' }}>
            {item.uncertain && (
              <span title={t('scan.uncertainBadge')} aria-label={t('scan.uncertainBadge')} style={{ position: 'absolute', top: '4px', right: '4px', zIndex: 1, background: 'var(--accent-yellow)', color: '#000', fontWeight: 900, fontSize: '0.7rem', borderRadius: '999px', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>?</span>
            )}
            {item.quantity > 1 && (
              <span style={{ position: 'absolute', bottom: '4px', right: '4px', zIndex: 1, background: 'rgba(0,0,0,0.75)', color: 'var(--text-strong)', fontWeight: 800, fontSize: '0.65rem', borderRadius: '4px', padding: '1px 4px' }}>x{item.quantity}</span>
            )}
            <img
              src={item.image_url}
              alt={getCardDisplayName(item.name, item.language, item.printed_name)}
              draggable={false}
              style={{ width: '76px', height: '106px', objectFit: 'cover', borderRadius: '4px', border: selected ? '2px solid var(--accent-red)' : '1px solid var(--border-glass)', boxShadow: selected ? '0 0 12px var(--accent-red-glow)' : '0 2px 6px rgba(0,0,0,0.3)', pointerEvents: 'none' }}
            />
            </div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-yellow)', textAlign: 'center' }}><Price value={item.price_trend} currency={item.price_currency} /></div>
            {/* Foil or not: what a scan cannot see, so it is one tap here. Its own
                button, kept out of the tile's tap and long-press. */}
            {(() => {
              const foil = item.printing !== 'Normal';
              return (
                <button
                  type="button"
                  className={`btn ${foil ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={recentSelect.selectMode || switching.has(item.entry_id)}
                  onClick={(e) => { e.stopPropagation(); flip(item); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={t('scan.toggleFoil')}
                  aria-pressed={foil}
                  style={{ fontSize: '0.6rem', padding: '0.15rem 0.3rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem', minHeight: 0, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}
                >
                  {foil && <Sparkles size={10} style={{ flexShrink: 0 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{printingLabel(t, item.printing, item.game)}</span>
                </button>
              );
            })()}
            {item.placementLabel && (
              <div style={{ fontSize: '0.55rem', color: '#ffc107', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.placementLabel}>{item.placementLabel}</div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(RecentScans);
