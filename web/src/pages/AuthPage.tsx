import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, type Me, type WebConfig } from '../api';
import { Icon } from '../icons';
import { t, useLang } from '../i18n';
import { TitleBar } from '../chrome';
import { AsanSpinner } from '../loader';
import { PasswordInput } from '../ui';

type Mode = 'login' | 'register';

const EMPTY = { first_name: '', last_name: '', username: '', email: '', phone: '', password: '', password2: '' };

export function AuthPage({ cfg, onDone }: { cfg: WebConfig | null; onDone: (me: Me) => void }) {
  useLang();
  const [mode, setMode] = useState<Mode>(() => (location.hash === '#register' ? 'register' : 'login'));
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const switchTo = (m: Mode) => {
    setMode(m);
    setError('');
    setFields({});
    history.replaceState(null, '', m === 'register' ? '#register' : location.pathname);
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.status === 0 ? t('network_error') : e.message);
      setFields(e.fields);
    } else {
      setError(t('network_error'));
    }
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api.login(identifier.trim(), password, remember));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.password2) {
      setFields({ password2: t('auth_password_mismatch') });
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    setFields({});
    try {
      const { password2: _ignored, ...data } = form;
      void _ignored;
      onDone(await api.register(data));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const field = (k: keyof typeof EMPTY, label: string, input: ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={`f-${k}`}>{label}</label>
      {input}
      {fields[k] ? <span className="err">{fields[k]}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
  const text = (k: keyof typeof EMPTY, autoComplete: string, opts: { ltr?: boolean; type?: string; inputMode?: 'tel' | 'email' } = {}) => (
    <input
      id={`f-${k}`}
      name={k}
      className={`input${opts.ltr ? ' ltr' : ''}${fields[k] ? ' bad' : ''}`}
      dir={opts.ltr ? 'ltr' : undefined}
      type={opts.type ?? 'text'}
      inputMode={opts.inputMode}
      value={form[k]}
      onChange={(e) => set(k)(e.target.value)}
      autoComplete={autoComplete}
      required
    />
  );

  return (
    <div className="auth">
      <TitleBar />
      <div className="auth-body">
        <div className="card auth-card">
          <aside className="auth-side">
            <div className="hero-icon">
              <Icon name="shield" size={28} />
            </div>
            <h2>{t('auth_side_title')}</h2>
            <ul>
              <li>
                <Icon name="monitor" />
                {t('auth_side_1')}
              </li>
              <li>
                <Icon name="share" />
                {t('auth_side_2')}
              </li>
              <li>
                <Icon name="lock" />
                {t('auth_side_3')}
              </li>
            </ul>
            <a className="install-box" href={cfg?.download_url || 'https://asandesk.ir/download'} target="_blank" rel="noopener noreferrer">
              <span className="i">
                <Icon name="download" />
              </span>
              <div>
                <b>{t('install_title')}</b>
                <span>{t('install_text')}</span>
              </div>
              <span className="chev">
                <Icon name="chevronRight" />
              </span>
            </a>
          </aside>

          {mode === 'login' ? (
            <form className="auth-form" onSubmit={submitLogin}>
              <div className="auth-switch">
                <button type="button" className="on">{t('auth_login')}</button>
                <button type="button" onClick={() => switchTo('register')}>{t('auth_register')}</button>
              </div>
              <h1>{t('auth_login_title')}</h1>
              <p>{t('auth_login_sub')}</p>
              <div className="field">
                <label htmlFor="f-identifier">{t('auth_identifier')}</label>
                <input
                  id="f-identifier"
                  name="username"
                  className="input ltr"
                  dir="ltr"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="f-password">{t('auth_password')}</label>
                <PasswordInput id="f-password" name="password" value={password} onChange={setPassword} autoComplete="current-password" />
              </div>
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t('auth_remember')}
              </label>
              {error && <div className="alert bad">{error}</div>}
              <button className="btn primary block" disabled={busy || !identifier || !password}>
                {busy ? <AsanSpinner /> : <Icon name="logout" style={{ transform: 'scaleX(-1)' }} />}
                {t('auth_submit_login')}
              </button>
              <div className="auth-foot">{t('auth_forgot')}</div>
              <div className="auth-foot">
                {t('auth_no_account')}
                <button type="button" onClick={() => switchTo('register')}>{t('auth_register')}</button>
              </div>
            </form>
          ) : (
            <form className="auth-form" onSubmit={submitRegister}>
              <div className="auth-switch">
                <button type="button" onClick={() => switchTo('login')}>{t('auth_login')}</button>
                <button type="button" className="on">{t('auth_register')}</button>
              </div>
              <h1>{t('auth_register_title')}</h1>
              <p>{t('auth_register_sub')}</p>
              <div className="grid2">
                {field('first_name', t('auth_first_name'), text('first_name', 'given-name'))}
                {field('last_name', t('auth_last_name'), text('last_name', 'family-name'))}
              </div>
              {field('username', t('auth_username'), text('username', 'username', { ltr: true }), t('auth_username_hint'))}
              <div className="grid2">
                {field('email', t('auth_email'), text('email', 'email', { ltr: true, type: 'email', inputMode: 'email' }))}
                {field('phone', t('auth_phone'), text('phone', 'tel', { ltr: true, type: 'tel', inputMode: 'tel' }))}
              </div>
              <div className="grid2">
                {field(
                  'password',
                  t('auth_password'),
                  <PasswordInput id="f-password" name="new-password" value={form.password} onChange={set('password')} autoComplete="new-password" bad={!!fields.password} />,
                )}
                {field(
                  'password2',
                  t('auth_password2'),
                  <PasswordInput id="f-password2" value={form.password2} onChange={set('password2')} autoComplete="new-password" bad={!!fields.password2} />,
                )}
              </div>
              {error && <div className="alert bad">{error}</div>}
              <button className="btn primary block" disabled={busy}>
                {busy ? <AsanSpinner /> : <Icon name="check" />}
                {t('auth_submit_register')}
              </button>
              <div className="auth-foot">
                {t('auth_have_account')}
                <button type="button" onClick={() => switchTo('login')}>{t('auth_login')}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
