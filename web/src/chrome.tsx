// نوار بالا و نوار وضعیت پایین (مثل پنجرهٔ برنامهٔ دسکتاپ)
import type { ReactNode } from 'react';
import { Icon } from './icons';
import { setLang, t, useLang } from './i18n';
import { setTheme, useTheme } from './theme';

export const WEB_VERSION = '1.0.0';

export function TitleBar({ children }: { children?: ReactNode }) {
  const lang = useLang();
  const theme = useTheme();
  return (
    <header className="titlebar">
      <div className="brand">
        <span className="logo">
          <Icon name="shield" size={15} />
        </span>
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

export function StatusBar({ server, host, delay }: { server: ServerState; host: string; delay: number | null }) {
  useLang();
  const label = server === 'ok' ? t('status_ok') : server === 'connecting' ? t('status_connecting') : t('status_down');
  return (
    <footer className="statusbar">
      <span className={`dot${server === 'connecting' ? ' warn' : server === 'down' ? ' bad' : ''}`} />
      <span>{label}</span>
      <span className="ltr hide-sm">{host}</span>
      <span className="grow" />
      {delay !== null && (
        <span className="ltr num hide-sm" title={t('latency')}>
          {delay}ms
        </span>
      )}
      <span>
        {t('web_version')} {WEB_VERSION}
      </span>
    </footer>
  );
}
