import { useEffect, useState } from 'react';
import { ApiError, api, type Me, type WebConfig } from './api';
import { TitleBar } from './chrome';
import { t, useLang } from './i18n';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { AsanLoader } from './loader';
import { ToastHost } from './ui';

type Boot = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; cfg: WebConfig; me: Me | null };

export function App() {
  useLang();
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });

  const load = () => {
    setBoot({ phase: 'loading' });
    Promise.all([
      api.config(),
      api.me().catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    ]).then(
      ([cfg, me]) => setBoot({ phase: 'ready', cfg, me }),
      () => setBoot({ phase: 'error' }),
    );
  };

  useEffect(load, []);

  if (boot.phase === 'loading') return <AsanLoader full label={t('st_connecting')} />;
  if (boot.phase !== 'ready') {
    return (
      <div className="auth">
        <TitleBar />
        <div className="auth-body">
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', maxWidth: 380, textAlign: 'center' }}>
            <span>{t('network_error')}</span>
            <button className="btn primary" onClick={load}>{t('reconnect')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {boot.me ? (
        <HomePage cfg={boot.cfg} me={boot.me} onLogout={() => setBoot({ ...boot, me: null })} />
      ) : (
        <AuthPage cfg={boot.cfg} onDone={(me) => setBoot({ ...boot, me })} />
      )}
      <ToastHost />
    </>
  );
}
