// نوار بالا و نوار وضعیت پایین (مثل پنجرهٔ برنامهٔ دسکتاپ)
import type { ReactNode } from 'react';
import { Icon } from './icons';
import { setLang, t, useLang } from './i18n';
import { AsanSpinner, Logo } from './loader';
import { setTheme, useTheme } from './theme';
import { WEB_VERSION } from './version';

export function TitleBar({ children }: { children?: ReactNode }) {
  const lang = useLang();
  const theme = useTheme();
  return (
    <header className="titlebar">
      <div className="brand">
        <Logo size={22} />
        {t('app_name')}
        <span className="web-tag">{t('web_version')}</span>
      </div>
      <div className="spacer" />
      <div className="seg" role="group" aria-label="language">
        <button className={lang === 'fa' ? 'on' : ''} onClick={() => setLang('fa')}>FA</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      </div>
      <div className="seg" role="group" aria-label="theme">
        <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')} title={t('theme_light')}>
          <Icon name="sun" size={14} />
        </button>
        <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')} title={t('theme_dark')}>
          <Icon name="moon" size={14} />
        </button>
      </div>
      {children}
    </header>
  );
}

export type ServerState = 'ok' | 'connecting' | 'down';

/** نوار پایین مثل برنامهٔ دسکتاپ: وضعیت سرور و نشانی آن، و آن طرف نسخه، بارگذاری مجدد و تأخیر */
export function StatusBar({
  server, host, delay, onReload, reloading,
}: {
  server: ServerState;
  host: string;
  delay: number | null;
  onReload?: () => void;
  reloading?: boolean;
}) {
  useLang();
  const label = server === 'ok' ? t('status_ok') : server === 'connecting' ? t('status_connecting') : t('status_down');
  return (
    <footer className="statusbar">
      <span className={`dot${server === 'connecting' ? ' warn' : server === 'down' ? ' bad' : ''}`} />
      <span>{label}</span>
      <span className="ltr hide-sm">{host}</span>
      <span className="grow" />
      {onReload && (
        <>
          <span className="ltr num status-delay" title={t('latency')}>
            <Icon name="wifi" size={14} />
            {delay !== null ? `${delay}ms` : '—'}
          </span>
          <button className="status-btn" onClick={onReload} disabled={reloading} title={t('asan_reload')} aria-label={t('asan_reload')}>
            {reloading ? <AsanSpinner size={14} /> : <Icon name="refresh" size={14} />}
          </button>
          <span className="status-sep" />
        </>
      )}
      <span>{t('version')}</span>
      <span className="ltr num">{WEB_VERSION}</span>
    </footer>
  );
}
