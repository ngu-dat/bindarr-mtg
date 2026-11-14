import { useState } from 'react';
import { X } from 'lucide-react';
import Modal from '../Modal';
import CardImage from '../CardImage';
import Price from '../Price';
import { onActivateKey } from '../../utils/a11y';
import { getCardDisplayName } from '../../utils/langHelper';
import { useT } from '../../utils/i18n';

// Correcting a scan after the fact. Auto-add files its best guess and keeps the
// camera running; the runner-up matches ride along on the tile, and tapping the
// tile opens this: the card as it was filed, the alternatives, and a way into
// the full editor. Picking an alternative replaces the filed copy.
export default function ScanCorrectModal({ item, addLanguage, onClose, onPick, onEdit }) {
  const { t } = useT();
  const [busyId, setBusyId] = useState(null);
  const pick = async (card) => {
    if (busyId) return;
    setBusyId(card.id);
    try { await onPick(card); } finally { setBusyId(null); }
  };
  const name = getCardDisplayName(item.name, item.language, item.printed_name);

  return (
    <Modal onClose={onClose} label={t('scan.correctTitle')} overlayStyle={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
    }} className="glass-panel" style={{ maxWidth: '560px', width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-strong)', margin: 0 }}>{t('scan.correctTitle')}</h3>
        <button className="btn btn-secondary btn-icon-only" onClick={onClose} style={{ borderRadius: '50%' }} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <CardImage card={item} style={{ width: '64px', aspectRatio: 0.718, objectFit: 'cover', borderRadius: '4px', border: '2px solid var(--accent-red)' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('scan.correctHint', { name })}</p>
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{item.set_name} • #{item.number}</p>
          {item.uncertain && (
            <p style={{ margin: '0.25rem 0 0', color: 'var(--accent-yellow)', fontSize: '0.75rem' }}>{t('scan.correctUncertain')}</p>
          )}
        </div>
        <button className="btn btn-secondary" onClick={onEdit} style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', flexShrink: 0 }}>{t('scan.editEntry')}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.75rem' }}>
        {item.alternatives.map(card => (
          <div
            key={card.id}
            role="button"
            tabIndex={0}
            aria-busy={busyId === card.id}
            onClick={() => pick(card)}
            onKeyDown={onActivateKey(() => pick(card))}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', cursor: busyId ? 'progress' : 'pointer', opacity: busyId && busyId !== card.id ? 0.5 : 1 }}
          >
            <CardImage card={card} style={{ width: '100%', aspectRatio: 0.718, objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-glass)' }} />
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {getCardDisplayName(card.name, addLanguage(card), card.printed_name)}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.set_name} • #{card.number}</div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-yellow)' }}><Price value={card.price_trend} currency={card.price_currency} /></div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
