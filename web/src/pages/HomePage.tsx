import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type Device, type Me, type WebConfig } from '../api';
import { StatusBar, TitleBar, type ServerState } from '../chrome';
import { Icon, osIcon } from '../icons';
import { formatId, relativeDay, t, useLang } from '../i18n';
import { GatewayClient, type GatewayState } from '../net/gateway';
import { ShareHost, shareSupported, type IncomingRequest, type Viewer } from '../net/share';
import { webCodecsAvailable } from '../net/video';
import { DialogTitle, Menu, Modal, PasswordInput, QrCode, Spinner, copyText, toast } from '../ui';
import { SessionView } from './SessionView';

type Tab = 'all' | 'recent' | 'fav';

function cleanCode(v: string): string {
  return v.replace(/[\s‌]/g, '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).slice(0, 32);
}

export function HomePage({ cfg, me, onLogout }: { cfg: WebConfig; me: Me; onLogout: () => void }) {
  useLang();
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [session, setSession] = useState<{ peerId: string; key: number } | null>(null);
  const [gwState, setGwState] = useState<GatewayState>('connecting');
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [otp, setOtp] = useState('');
  const [dialog, setDialog] = useState<null | 'otp' | 'qr' | 'account' | 'install'>(null);
  const [menu, setMenu] = useState<null | { kind: 'user' | 'recent' | 'more' | 'device'; anchor: HTMLElement; device?: Device }>(null);
  const [renaming, setRenaming] = useState<Device | null>(null);
  const hostRef = useRef<ShareHost | null>(null);
  const gwRef = useRef<GatewayClient | null>(null);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;
  const viewersRef = useRef(0);
  viewersRef.current = viewers.length;
  const canShare = useMemo(() => shareSupported(), []);
  const canView = useMemo(() => webCodecsAvailable(), []);

  const loadDevices = useCallback(() => {
    api.devices().then(
      (d) => {
        setDevices(d);
        setDevicesLoaded(true);
      },
      () => setDevicesLoaded(true),
    );
  }, []);

  useEffect(loadDevices, [loadDevices]);

  // اشتراک صفحه: کلید هویت حساب و اتصال به درگاه
  useEffect(() => {
    if (!canShare) return;
    let disposed = false;
    let host: ShareHost | null = null;
    let gw: GatewayClient | null = null;
    api.peerKey().then(
      (key) => {
        if (disposed) return;
        host = new ShareHost(cfg, { webId: key.web_id, seed: key.seed, name: me.full_name }, {
          onRequest: (req) => setRequests((r) => [...r.filter((x) => x.key !== req.key), req]),
          onRequestGone: (k) => setRequests((r) => r.filter((x) => x.key !== k)),
          onViewers: (v) => setViewers([...v]),
          onLog: (dir, peerId, peerName) => api.connectionStart(dir, peerId, peerName).catch(() => null),
          onLogEnd: (id) => void api.connectionEnd(id).catch(() => undefined),
          onError: (k) => toast(t(k)),
        });
        host.onOtp = setOtp;
        setOtp(host.otp);
        hostRef.current = host;
        gw = new GatewayClient(cfg.gw_ws, {
          onState: setGwState,
          onIncoming: (uuid, relay) => void host?.handleIncoming(uuid, relay),
          // ورود باطل شده (مسدودی یا رمز تازه از پنل): به صفحهٔ ورود برمی‌گردیم
          onUnauthorized: () =>
            void api.me().catch((e) => {
              if (e instanceof ApiError && e.status === 401) onLogoutRef.current();
            }),
        });
        gwRef.current = gw;
        gw.start();
      },
      () => setGwState('offline'),
    );
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (hostRef.current && viewersRef.current > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      disposed = true;
      window.removeEventListener('beforeunload', beforeUnload);
      gw?.stop();
      host?.dispose();
      hostRef.current = null;
      gwRef.current = null;
    };
  }, [cfg, me.full_name, canShare]);

  const logout = async () => {
    gwRef.current?.stop();
    hostRef.current?.dispose();
    await api.logout().catch(() => undefined);
    onLogout();
  };

  const startSession = (peerId: string) => {
    const id = cleanCode(peerId);
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
      setCodeError(t('code_invalid'));
      return;
    }
    if (id === me.web_id) {
      setCodeError(t('code_self'));
      return;
    }
    if (!canView) {
      setCodeError(t('no_webcodecs'));
      return;
    }
    setCodeError('');
    setSession({ peerId: id, key: Date.now() });
  };

  const onConnectSubmit = (e: FormEvent) => {
    e.preventDefault();
    startSession(code);
  };

  const toggleFavorite = async (d: Device) => {
    try {
      const updated = await api.updateDevice(d.peer_id, { favorite: !d.favorite });
      setDevices((list) => list.map((x) => (x.peer_id === d.peer_id ? updated : x)));
    } catch {
      toast(t('network_error'));
    }
  };

  const removeDevice = async (d: Device) => {
    try {
      await api.removeDevice(d.peer_id);
      setDevices((list) => list.filter((x) => x.peer_id !== d.peer_id));
    } catch {
      toast(t('network_error'));
    }
  };

  const shown = useMemo(() => {
    let list = devices;
    if (tab === 'fav') list = list.filter((d) => d.favorite);
    if (tab === 'recent') {
      const week = Date.now() - 7 * 86_400_000;
      list = list.filter((d) => new Date(d.last_connected_at).getTime() >= week);
    }
    const q = query.trim().toLowerCase().replace(/\s/g, '');
    if (q) list = list.filter((d) => d.peer_id.includes(q) || d.name.toLowerCase().replace(/\s/g, '').includes(q));
    return list;
  }, [devices, tab, query]);

  const server: ServerState = !canShare ? 'ok' : gwState === 'online' ? 'ok' : gwState === 'offline' ? 'down' : gwState === 'connecting' ? 'connecting' : 'ok';
  const request = requests[0] ?? null;

  return (
    <div className="shell">
      <TitleBar>
        <button className="icon-btn" onClick={(e) => setMenu({ kind: 'user', anchor: e.currentTarget })} aria-label={t('menu')}>
          <Icon name="menu" />
        </button>
      </TitleBar>

      <main className="main">
        <Hero
          state={canShare ? gwState : 'unsupported'}
          code={me.web_id}
          onCopy={async () => toast((await copyText(me.web_id)) ? t('copied') : me.web_id)}
          onOtp={() => setDialog('otp')}
          onQr={() => setDialog('qr')}
          onTakeOver={() => gwRef.current?.takeOver()}
        />

        {viewers.length > 0 && (
          <div className="share-bar">
            <span className="live" />
            <span className="who">
              {t('share_active')}{' '}
              {viewers.map((v, i) => (
                <span key={v.key}>
                  {i > 0 && '، '}
                  <b>{v.peerName || formatId(v.peerId)}</b> <span className="ltr">({formatId(v.peerId)})</span>
                </span>
              ))}
            </span>
            <button className="btn small danger" onClick={() => hostRef.current?.stopAll()}>
              <Icon name="stop" size={16} />
              {t('share_stop_all')}
            </button>
          </div>
        )}

        <div className="lower">
          <section className="card panel connect-card">
            <div className="panel-head">
              <h3>
                <Icon name="download" style={{ transform: 'rotate(180deg)' }} />
                {t('connect_title')}
              </h3>
            </div>
            <div className="sub">{t('asan_connect_sub')}</div>
            <form onSubmit={onConnectSubmit}>
              <div className="field">
                <label htmlFor="target-code">{t('asan_target_code')}</label>
                <div className="connect-row">
                  <input
                    id="target-code"
                    className={`code-input num${codeError ? ' bad' : ''}`}
                    value={formatId(code)}
                    onChange={(e) => {
                      setCode(cleanCode(e.target.value));
                      setCodeError('');
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    className="recent-btn"
                    title={t('recent_pick')}
                    onClick={(e) => setMenu({ kind: 'recent', anchor: e.currentTarget })}
                  >
                    <Icon name="users" size={18} />
                    <Icon name="chevronDown" size={13} />
                  </button>
                </div>
              </div>
              <div className="actions-row">
                <button type="submit" className="btn primary" disabled={!code}>
                  <Icon name="monitor" />
                  {t('connect')}
                </button>
                <button type="button" className="btn outline-accent locked" onClick={() => setDialog('install')}>
                  <Icon name="file" />
                  {t('file_transfer')}
                </button>
                <button type="button" className="btn square" onClick={(e) => setMenu({ kind: 'more', anchor: e.currentTarget })} aria-label={t('more')}>
                  <Icon name="more" />
                </button>
              </div>
              <div className="form-err">{codeError}</div>
            </form>
            <a className="install-box" href={cfg.download_url} target="_blank" rel="noopener noreferrer">
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
          </section>

          <section className="card panel">
            <div className="panel-head">
              <h3>
                <Icon name="monitor" />
                {t('asan_your_devices')}
              </h3>
              <span className="sub">{t('asan_your_devices_sub')}</span>
            </div>
            <div className="tabs-row">
              <div className="tabs" role="tablist">
                <button className={`tab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
                  <Icon name="grid" size={16} />
                  {t('asan_tab_all')}
                </button>
                <button className={`tab${tab === 'recent' ? ' on' : ''}`} onClick={() => setTab('recent')}>
                  <Icon name="clock" size={16} />
                  {t('asan_tab_recent')}
                </button>
                <button className={`tab${tab === 'fav' ? ' on' : ''}`} onClick={() => setTab('fav')}>
                  <Icon name="star" size={16} />
                  {t('favorites')}
                </button>
              </div>
              <div className="search">
                <Icon name="search" size={16} />
                <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('asan_search_placeholder')} />
              </div>
            </div>
            <div className="devices">
              {!devicesLoaded ? (
                <div className="empty">
                  <Spinner big />
                </div>
              ) : shown.length === 0 ? (
                <div className="empty">
                  <span className="i">
                    <Icon name={query ? 'search' : tab === 'fav' ? 'star' : 'monitor'} size={24} />
                  </span>
                  <b>{query ? t('no_match') : tab === 'fav' ? t('no_favorites') : t('asan_no_devices')}</b>
                  {!query && tab !== 'fav' && <span>{t('no_devices_sub')}</span>}
                </div>
              ) : (
                shown.map((d) => (
                  <article key={d.peer_id} className="device">
                    <div className="device-top">
                      <span className="os-box">
                        <Icon name={osIcon(d.platform)} size={30} />
                      </span>
                      <div className="device-text">
                        <div className="device-name">
                          <span className="d" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name || formatId(d.peer_id)}</span>
                        </div>
                        <div className="device-id num">{formatId(d.peer_id)}</div>
                        <div className="device-when">{relativeDay(d.last_connected_at)}</div>
                      </div>
                      <button className={`star${d.favorite ? ' on' : ''}`} onClick={() => toggleFavorite(d)} title={d.favorite ? t('fav_remove') : t('fav_add')}>
                        <Icon name="star" size={17} />
                      </button>
                    </div>
                    <div className="device-actions">
                      <button className="btn" onClick={() => startSession(d.peer_id)}>
                        <Icon name="monitor" size={16} />
                        {t('connect')}
                      </button>
                      <button className="btn square" onClick={(e) => setMenu({ kind: 'device', anchor: e.currentTarget, device: d })} aria-label={t('more')}>
                        <Icon name="more" size={16} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      <StatusBar server={server} host={cfg.rendezvous_host} delay={null} />

      {menu?.kind === 'user' && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <div className="menu-head">
            <b>{me.full_name}</b>
            <span className="ltr">{me.username}</span>
          </div>
          <button onClick={() => setDialog('account')}>
            <Icon name="user" size={16} />
            {t('menu_account')}
          </button>
          <a href={cfg.download_url} target="_blank" rel="noopener noreferrer">
            <Icon name="download" size={16} />
            {t('menu_download')}
          </a>
          <button className="danger" onClick={logout}>
            <Icon name="logout" size={16} />
            {t('menu_logout')}
          </button>
        </Menu>
      )}
      {menu?.kind === 'recent' && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          {devices.length === 0 ? (
            <div className="menu-head">
              <span>{t('asan_no_devices')}</span>
            </div>
          ) : (
            devices.slice(0, 8).map((d) => (
              <button key={d.peer_id} onClick={() => setCode(d.peer_id)}>
                <Icon name={osIcon(d.platform)} size={16} />
                <span style={{ flex: 1 }}>{d.name || formatId(d.peer_id)}</span>
                <span className="ltr num" style={{ color: 'var(--accent-bright)' }}>{formatId(d.peer_id)}</span>
              </button>
            ))
          )}
        </Menu>
      )}
      {menu?.kind === 'more' && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          {['file_transfer'].map((k) => (
            <button key={k} onClick={() => setDialog('install')}>
              <Icon name="lock" size={16} />
              {t(k)}
            </button>
          ))}
          <a href={cfg.download_url} target="_blank" rel="noopener noreferrer">
            <Icon name="download" size={16} />
            {t('menu_download')}
          </a>
        </Menu>
      )}
      {menu?.kind === 'device' && menu.device && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <button onClick={() => toggleFavorite(menu.device!)}>
            <Icon name="star" size={16} />
            {menu.device.favorite ? t('fav_remove') : t('fav_add')}
          </button>
          <button onClick={() => setRenaming(menu.device!)}>
            <Icon name="edit" size={16} />
            {t('rename')}
          </button>
          <button onClick={async () => toast((await copyText(menu.device!.peer_id)) ? t('copied') : '')}>
            <Icon name="copy" size={16} />
            {t('copy')}
          </button>
          <button className="danger" onClick={() => removeDevice(menu.device!)}>
            <Icon name="trash" size={16} />
            {t('remove')}
          </button>
        </Menu>
      )}

      {dialog === 'otp' && <OtpDialog otp={otp} onNew={() => hostRef.current?.refreshOtp()} onClose={() => setDialog(null)} />}
      {dialog === 'qr' && (
        <Modal onClose={() => setDialog(null)} width={340}>
          <DialogTitle icon="qr">{t('asan_show_qr')}</DialogTitle>
          <QrCode text={me.web_id} />
          <p style={{ textAlign: 'center' }}>{t('asan_qr_hint')}</p>
          <div className="row">
            <button className="btn" onClick={() => setDialog(null)}>{t('ok')}</button>
          </div>
        </Modal>
      )}
      {dialog === 'install' && (
        <Modal onClose={() => setDialog(null)}>
          <DialogTitle icon="download">{t('install_title')}</DialogTitle>
          <p>{t('install_feature')}</p>
          <div className="row">
            <button className="btn" onClick={() => setDialog(null)}>{t('cancel')}</button>
            <a className="btn primary" href={cfg.download_url} target="_blank" rel="noopener noreferrer" onClick={() => setDialog(null)}>
              <Icon name="download" />
              {t('menu_download')}
            </a>
          </div>
        </Modal>
      )}
      {dialog === 'account' && <AccountDialog me={me} onClose={() => setDialog(null)} />}
      {renaming && (
        <RenameDialog
          device={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(d) => setDevices((list) => list.map((x) => (x.peer_id === d.peer_id ? d : x)))}
        />
      )}
      {request && (
        <IncomingDialog
          req={request}
          onAllow={() => void hostRef.current?.approve(request.key)}
          onReject={() => hostRef.current?.reject(request.key)}
        />
      )}

      {session && (
        <SessionView
          key={session.key}
          cfg={cfg}
          peerId={session.peerId}
          me={me}
          onConnected={(info) => {
            // مثل کارت‌های برنامهٔ دسکتاپ: user@host؛ برای کاربر وب فقط نامش
            const name = info.platform === 'WebDesktop' ? info.username : info.username ? `${info.username}@${info.hostname}` : info.hostname;
            api.touchDevice(session.peerId, name, info.platform).then(
              (d) => setDevices((list) => [d, ...list.filter((x) => x.peer_id !== d.peer_id)]),
              () => undefined,
            );
          }}
          onExit={() => {
            setSession(null);
            loadDevices();
          }}
        />
      )}
    </div>
  );
}

function Hero({
  state, code, onCopy, onOtp, onQr, onTakeOver,
}: {
  state: GatewayState | 'unsupported';
  code: string;
  onCopy: () => void;
  onOtp: () => void;
  onQr: () => void;
  onTakeOver: () => void;
}) {
  const look =
    state === 'online' ? '' : state === 'connecting' || state === 'busy' || state === 'replaced' ? 'connecting' : 'offline';
  const icon =
    state === 'online' ? 'shield' : state === 'connecting' || state === 'busy' ? 'refresh' : state === 'blocked' ? 'block' : state === 'replaced' ? 'info' : 'warning';
  const [title, body, badge] = (() => {
    switch (state) {
      case 'online':
        return [t('asan_state_ready_title'), t('asan_state_ready_body'), t('asan_state_ready_badge')];
      case 'connecting':
      case 'busy':
        return [t('asan_state_connecting_title'), t('asan_state_connecting_body'), t('asan_state_connecting_badge')];
      case 'blocked':
        return [t('hero_blocked_title'), t('hero_blocked_body'), t('hero_blocked_title')];
      case 'conflict':
        return [t('hero_conflict_title'), t('hero_conflict_body'), t('asan_state_offline_badge')];
      case 'replaced':
        return [t('hero_replaced_title'), t('hero_replaced_body'), t('asan_state_offline_badge')];
      case 'unsupported':
        return [t('asan_state_offline_title'), t('hero_unsupported_body'), t('asan_state_offline_badge')];
      default:
        return [t('asan_state_offline_title'), t('asan_state_offline_body'), t('asan_state_offline_badge')];
    }
  })();
  return (
    <section className={`hero ${look}`}>
      <div className="hero-status">
        <div className="hero-icon">
          <Icon name={icon} size={28} />
        </div>
        <h2>{title}</h2>
        <p>{body}</p>
        {state === 'replaced' && (
          <button className="btn small" onClick={onTakeOver}>
            {t('hero_use_here')}
          </button>
        )}
      </div>
      <div className="hero-divider" />
      <div className="hero-code">
        <div className="hero-label">
          {t('asan_your_code')}
          <span className="badge">
            <span className="d" />
            {badge}
          </span>
        </div>
        <div className="big-code num">{formatId(code)}</div>
        <div className="hero-actions">
          <button className="hero-btn" onClick={onQr}>
            <Icon name="qr" size={20} />
            {t('asan_show_qr')}
          </button>
          <button className="hero-btn" onClick={onOtp} disabled={state === 'unsupported'}>
            <Icon name="key" size={20} />
            {t('otp')}
          </button>
          <button className="hero-btn" onClick={onCopy}>
            <Icon name="copy" size={20} />
            {t('asan_copy_code')}
          </button>
        </div>
        <div className="hero-note">
          <Icon name="info" size={14} />
          {t('view_only_note')}
        </div>
      </div>
    </section>
  );
}

function OtpDialog({ otp, onNew, onClose }: { otp: string; onNew: () => void; onClose: () => void }) {
  return (
    <Modal onClose={onClose} width={380}>
      <DialogTitle icon="key">{t('otp_title')}</DialogTitle>
      <p>{t('otp_sub')}</p>
      <div className="otp-value">{otp}</div>
      <div className="row">
        <button className="btn" onClick={onNew}>
          <Icon name="refresh" size={16} />
          {t('otp_new')}
        </button>
        <button className="btn primary" onClick={async () => toast((await copyText(otp)) ? t('copied') : otp)}>
          <Icon name="copy" size={16} />
          {t('copy')}
        </button>
      </div>
    </Modal>
  );
}

function IncomingDialog({ req, onAllow, onReject }: { req: IncomingRequest; onAllow: () => void; onReject: () => void }) {
  const [left, setLeft] = useState(60);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [req.key]);
  return (
    <Modal width={440}>
      <DialogTitle icon="share">{t('share_request_title')}</DialogTitle>
      <div className="peer-chip">
        <span className="os-box">
          <Icon name={osIcon(req.platform)} size={24} />
        </span>
        <div>
          <b>{req.peerName || formatId(req.peerId)}</b>
          <span className="ltr num">{formatId(req.peerId)}</span>
        </div>
      </div>
      <p>
        <b>{req.peerName || formatId(req.peerId)}</b> {t('share_request_text')}
      </p>
      <p style={{ fontSize: 12 }}>{t('share_auto_reject', left)}</p>
      <div className="row">
        <button className="btn" onClick={onReject}>{t('share_reject')}</button>
        <button className="btn primary" onClick={onAllow} autoFocus>
          <Icon name="share" />
          {t('share_allow')}
        </button>
      </div>
    </Modal>
  );
}

function AccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(current, next);
      setMsg({ ok: true, text: t('pw_changed') });
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && err.status ? err.message : t('network_error') });
    } finally {
      setBusy(false);
    }
  };
  const rows: [string, string, boolean][] = [
    [t('auth_username'), me.username, true],
    [t('auth_email'), me.email, true],
    [t('auth_phone'), me.phone, true],
    [t('account_code'), formatId(me.web_id), true],
    [t('account_since'), new Date(me.created_at).toLocaleDateString(document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-GB'), false],
  ];
  return (
    <Modal onClose={onClose} width={460}>
      <DialogTitle icon="user">{me.full_name}</DialogTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 13 }}>
        {rows.map(([k, v, ltr]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--muted)' }}>{k}</span>
            <span className={ltr ? 'ltr' : ''} style={{ textAlign: 'start' }}>{v}</span>
          </div>
        ))}
      </div>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <b style={{ fontSize: 14 }}>{t('menu_password')}</b>
        <div className="field">
          <label>{t('pw_current')}</label>
          <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
        </div>
        <div className="field">
          <label>{t('pw_new')}</label>
          <PasswordInput value={next} onChange={setNext} autoComplete="new-password" />
        </div>
        {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn primary" disabled={busy || !current || !next}>
            {busy && <Spinner />}
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog({ device, onClose, onSaved }: { device: Device; onClose: () => void; onSaved: (d: Device) => void }) {
  const [name, setName] = useState(device.name);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onSaved(await api.updateDevice(device.peer_id, { name: name.trim() }));
      onClose();
    } catch {
      toast(t('network_error'));
    }
  };
  return (
    <Modal onClose={onClose} width={380}>
      <DialogTitle icon="edit">{t('rename_title')}</DialogTitle>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={128} autoFocus />
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn primary">{t('save')}</button>
        </div>
      </form>
    </Modal>
  );
}
