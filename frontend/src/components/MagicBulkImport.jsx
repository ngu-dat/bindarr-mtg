import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, LoaderCircle, LogOut, ShieldAlert, Users } from 'lucide-react';
import Logo from './Logo';
import { useT } from '../utils/i18n';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function MagicBulkImport({ user, onLogout }) {
  const { locale, t } = useT();
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const selectedUser = users.find(item => String(item.id) === targetUserId);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setUsersLoading(false);
      return undefined;
    }
    let live = true;
    fetch('/api/admin/users')
      .then(readResponse)
      .then(list => {
        if (live) setUsers(Array.isArray(list) ? list : []);
      })
      .catch(err => {
        if (live) setUsersError(err.message || t('bulkImport.usersError'));
      })
      .finally(() => {
        if (live) setUsersLoading(false);
      });
    return () => { live = false; };
  }, [user, t]);

  const clearImport = () => {
    setFile(null);
    setCsvText('');
    setPreview(null);
    setResult(null);
    setError('');
  };

  const handleTargetChange = (event) => {
    setTargetUserId(event.target.value);
    clearImport();
  };

  const handleFileChange = async (event) => {
    const selected = event.target.files?.[0] || null;
    event.target.value = '';
    clearImport();
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.csv')) {
      setError(t('bulkImport.csvOnly'));
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError(t('bulkImport.fileTooLarge'));
      return;
    }
    if (!targetUserId) {
      setError(t('bulkImport.chooseUserFirst'));
      return;
    }

    setFile(selected);
    setBusy('preview');
    try {
      const text = await selected.text();
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUserId)}/mtg-import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text
      });
      setPreview(await readResponse(response));
      setCsvText(text);
    } catch (err) {
      setError(err.message || t('bulkImport.previewError'));
    } finally {
      setBusy('');
    }
  };

  const handleImport = async () => {
    if (!preview?.copyCount || !csvText || !targetUserId || result) return;
    setBusy('import');
    setError('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUserId)}/mtg-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csvText
      });
      setResult(await readResponse(response));
    } catch (err) {
      setError(err.message || t('bulkImport.importError'));
    } finally {
      setBusy('');
    }
  };

  const renderErrors = (errors = []) => errors.length > 0 && (
    <div className="glass-panel" style={{ borderColor: 'rgba(255,190,70,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-yellow)', fontWeight: 700, marginBottom: '0.65rem' }}>
        <AlertTriangle size={17} />
        {t('bulkImport.rowIssues', { count: number.format(new Set(errors.map(item => item.row)).size) })}
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)', display: 'grid', gap: '0.3rem' }}>
        {errors.map((item, index) => (
          <li key={`${item.row}-${item.field}-${index}`}>
            {item.row ? t('bulkImport.rowLabel', { row: item.row }) : t('bulkImport.fileLabel')}
            {item.field ? ` · ${item.field}` : ''}: {item.message}
          </li>
        ))}
      </ul>
    </div>
  );

  if (user?.role !== 'admin') {
    return (
      <div className="app-container">
        <header className="app-header">
          <a href="/" className="logo-section" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="logo-icon"><Logo /></div>
            <h1 className="logo-text">Bind<span>arr</span></h1>
          </a>
          <button type="button" onClick={onLogout} className="btn btn-secondary btn-icon-only" aria-label={t('header.logOut')} title={t('header.logOut')}>
            <LogOut size={15} />
          </button>
        </header>
        <main style={{ width: 'min(720px, 100%)', margin: '2rem auto' }}>
          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <ShieldAlert size={22} style={{ color: 'var(--accent-red)' }} />
            <div>
              <h2 style={{ color: 'var(--text-strong)', margin: 0 }}>{t('bulkImport.accessDenied')}</h2>
              <p style={{ color: 'var(--text-secondary)', margin: '0.35rem 0 0' }}>{t('bulkImport.adminOnly')}</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <a href="/" className="logo-section" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="logo-icon"><Logo /></div>
          <h1 className="logo-text">Bind<span>arr</span></h1>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('header.greeting')} <strong style={{ color: 'var(--text-strong)' }}>{user.username}</strong></span>
          <button type="button" onClick={onLogout} className="btn btn-secondary btn-icon-only" aria-label={t('header.logOut')} title={t('header.logOut')}>
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main style={{ width: 'min(900px, 100%)', margin: '1.5rem auto', display: 'grid', gap: '1rem', alignContent: 'start' }}>
        <a href="/" className="btn btn-secondary" style={{ width: 'fit-content', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', textDecoration: 'none' }}>
          <ArrowLeft size={15} /> {t('bulkImport.backToBindarr')}
        </a>

        <section className="glass-panel" style={{ display: 'grid', gap: '1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.8rem' }}>
            <FileUp size={22} style={{ color: 'var(--accent-yellow)' }} />
            <div>
              <h2 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1.2rem' }}>{t('bulkImport.title')}</h2>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('bulkImport.description')}</p>
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="bulk-import-user">{t('bulkImport.targetUser')}</label>
            <div style={{ position: 'relative' }}>
              <Users size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <select id="bulk-import-user" className="select-control" value={targetUserId} onChange={handleTargetChange} disabled={usersLoading || !!busy || users.length === 0} style={{ paddingLeft: '2.25rem' }}>
                <option value="">{usersLoading ? t('bulkImport.loadingUsers') : t('bulkImport.chooseUser')}</option>
                {users.map(item => <option key={item.id} value={item.id}>{item.username} · {item.role}</option>)}
              </select>
            </div>
            {usersError && <p role="alert" style={{ margin: '0.4rem 0 0', color: 'var(--accent-red)', fontSize: '0.8rem' }}>{usersError}</p>}
            {!usersLoading && !usersError && users.length === 0 && <p style={{ margin: '0.4rem 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('bulkImport.noUsers')}</p>}
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="bulk-import-file">{t('bulkImport.csvFile')}</label>
            <input id="bulk-import-file" type="file" accept=".csv,text/csv" onChange={handleFileChange} disabled={!targetUserId || !!busy || usersLoading} style={{ color: 'var(--text-secondary)' }} />
            <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{t('bulkImport.fileHint')}</p>
          </div>

          {error && <div role="alert" className="glass-panel" style={{ color: 'var(--accent-red)', padding: '0.8rem 1rem' }}>{error}</div>}
          {busy === 'preview' && <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', margin: 0 }}><LoaderCircle size={16} className="spin-animation" /> {t('bulkImport.previewing')}</p>}

          {file && preview && (
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              <div className="glass-panel" style={{ display: 'grid', gap: '0.8rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: 'var(--text-strong)', fontWeight: 700 }}>
                  <CheckCircle2 size={17} style={{ color: 'var(--accent-blue)' }} /> {file.name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
                  <span style={{ padding: '0.25rem 0.55rem', borderRadius: '999px', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{t('bulkImport.previewRows', { count: number.format(preview.rowCount) })}</span>
                  <span style={{ padding: '0.25rem 0.55rem', borderRadius: '999px', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{t('bulkImport.previewCopies', { count: number.format(preview.copyCount) })}</span>
                  {selectedUser && <span style={{ padding: '0.25rem 0.55rem', borderRadius: '999px', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{t('bulkImport.previewUser', { user: selectedUser.username })}</span>}
                </div>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('bulkImport.additiveHint')}</p>
                {preview.unsupportedColumns?.length > 0 && (
                  <p style={{ margin: 0, color: 'var(--accent-yellow)', fontSize: '0.8rem' }}>
                    <strong>{t('bulkImport.unsupported')}:</strong> {preview.unsupportedColumns.join(', ')}. {t('bulkImport.unsupportedHint')}
                  </p>
                )}
              </div>
              {renderErrors(preview.errors)}
              <button type="button" className="btn btn-primary" onClick={handleImport} disabled={!preview.copyCount || !!busy || !!result} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', justifySelf: 'start' }}>
                {busy === 'import' ? <LoaderCircle size={16} className="spin-animation" /> : <FileUp size={16} />}
                {busy === 'import' ? t('bulkImport.importing') : t('bulkImport.importButton', { count: number.format(preview.copyCount) })}
              </button>
            </div>
          )}

          {busy === 'import' && <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('bulkImport.importingHint')}</p>}
          {result && (
            <div role="status" className="glass-panel" style={{ borderColor: 'rgba(75,210,150,0.35)', display: 'grid', gap: '0.6rem' }}>
              <strong style={{ color: 'var(--accent-blue)' }}>{t('bulkImport.importComplete')}</strong>
              <span style={{ color: 'var(--text-secondary)' }}>{t('bulkImport.importResult', {
                copies: number.format(result.importedCopies), rows: number.format(result.importedRows),
                unmatched: number.format(result.unmatchedCopies), invalid: number.format(result.invalidRows)
              })}</span>
              {result.unsupportedColumns?.length > 0 && <span style={{ color: 'var(--accent-yellow)', fontSize: '0.8rem' }}>{t('bulkImport.unsupported')}: {result.unsupportedColumns.join(', ')}</span>}
              {renderErrors(result.errors)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default MagicBulkImport;
