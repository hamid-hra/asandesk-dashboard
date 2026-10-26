import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Me, type WebConfig } from '../api';
import { alog } from '../log';
import { Icon } from '../icons';
import { formatId, t, useLang } from '../i18n';
import { RemoteSession, type PeerSummary, type Quality, type SessionState } from '../net/session';
import { AsanLoader } from '../loader';
import { PasswordInput } from '../ui';

type Panel = null | 'display' | 'keys' | 'text';

/** علت شکست اتصال برای نمودار «چرا اتصال‌ها ناموفق‌اند» پنل (همان کدهای برنامهٔ دسکتاپ، CONN_FAILURE_GROUPS) */
const FAILURE_REASON: Record<string, string> = {
  err_id_server: 'server_unreachable',
  err_relay: 'relay_failed',
  err_peer_timeout: 'timeout',
  err_not_exist: 'id_not_exist',
  err_offline: 'offline',
  err_key_mismatch: 'key_mismatch',
  err_overuse: 'server_error',
  err_refused: 'rejected',
  err_wrong_password: 'wrong_password',
  err_too_many: 'too_many_attempts',
  err_not_allowed: 'not_allowed',
  err_ip_blocked: 'not_allowed',
  err_id_blocked: 'not_allowed',
  err_2fa_wrong: 'wrong_2fa',
  err_insecure: 'other',
  err_handshake: 'other',
  err_main_window: 'other',
  err_codec: 'other',
  err_other: 'other',
};

export function SessionView({
  cfg, peerId, me, onConnected, onExit, onFailed,
}: {
  cfg: WebConfig;
  peerId: string;
  me: Me;
  onConnected: (peer: PeerSummary) => void;
  onExit: () => void;
  onFailed?: (reason: string, detail: string) => void;
}) {
  useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<RemoteSession | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [fit, setFit] = useState(true);
  const [quality, setQualityState] = useState<Quality>('balanced');
  const [fullscreen, setFullscreen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reported = useRef(false);
  const logId = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = new RemoteSession(cfg, peerId, { webId: me.web_id, name: me.display_name }, canvas);
    sessionRef.current = s;
    reported.current = false;
    let lastKey = '';
    let wasConnected = false;
    const unsub = s.subscribe((st) => {
      setState(st);
      const key = `${st.phase}|${st.message}`;
      if (key !== lastKey) {
        lastKey = key;
        alog('session', peerId, st.phase, st.message, st.detail);
        if (st.phase === 'connected') wasConnected = true;
        // اتصال برقرار نشد، رمز اشتباه بود، یا بعد از وصل شدن بی‌خبر قطع شد
        const reason =
          st.phase === 'closed' && !wasConnected
            ? FAILURE_REASON[st.message]
            : st.phase === 'password' && st.message === 'err_wrong_password'
              ? 'wrong_password'
              : st.phase === 'closed' && st.message === 'st_peer_closed' && !st.detail
                ? 'dropped'
                : undefined;
        if (reason) onFailed?.(reason, st.detail);
      }
      if (st.phase === 'connected' && st.peer && !reported.current) {
        reported.current = true;
        onConnected(st.peer);
        api.connectionStart('out', peerId, st.peer.hostname).then((id) => (logId.current = id), () => undefined);
      }
      if (st.phase === 'closed' && logId.current !== null) {
        void api.connectionEnd(logId.current).catch(() => undefined);
        logId.current = null;
      }
    });
    void s.start();
    return () => {
      unsub();
      s.close();
      if (logId.current !== null) {
        void api.connectionEnd(logId.current).catch(() => undefined);
        logId.current = null;
      }
    };
    // onConnected عمداً در وابستگی‌ها نیست: هر رندر صفحهٔ اصلی تابع تازه می‌سازد و جلسه نباید دوباره شروع شود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, peerId, me.web_id, me.display_name, attempt]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const connected = state?.phase === 'connected';

  // کیبورد: وقتی تصویر فوکوس دارد همهٔ کلیدها به دستگاه مقصد می‌رود
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !connected) return;
    const down = (e: KeyboardEvent) => {
      if (sessionRef.current?.key(e, true)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (sessionRef.current?.key(e, false)) e.preventDefault();
    };
    stage.addEventListener('keydown', down);
    stage.addEventListener('keyup', up);
    stage.focus();
    return () => {
      stage.removeEventListener('keydown', down);
      stage.removeEventListener('keyup', up);
    };
  }, [connected]);

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sessionRef.current;
    if (!s) return;
    const [fx, fy] = pos(e);
    if (e.type === 'pointermove') s.mouseMove(fx, fy, e);
    else if (e.type === 'pointerdown') {
      stageRef.current?.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      s.mouseButton(fx, fy, e.button, true, e);
    } else if (e.type === 'pointerup') s.mouseButton(fx, fy, e.button, false, e);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sessionRef.current?.wheel(e.deltaX, e.deltaY, e.deltaMode, e);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        // در تمام‌صفحه کلیدهایی مثل Esc و Alt+Tab هم به دستگاه مقصد برسد (کروم)
        const kb = (navigator as unknown as { keyboard?: { lock?: () => Promise<void> } }).keyboard;
        await kb?.lock?.().catch(() => undefined);
      }
    } catch {
      /* fullscreen not allowed */
    }
  };

  const disconnect = () => {
    sessionRef.current?.close();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onExit();
  };

  const setQuality = (q: Quality) => {
    setQualityState(q);
    sessionRef.current?.setQuality(q);
  };

  const peer = state?.peer;
  const name = peer?.hostname || formatId(peerId);

  return (
    <div className="session" dir={document.documentElement.dir}>
      <div
        ref={stageRef}
        className={`session-stage${fit ? ' fit' : ''}`}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          style={{ visibility: connected && state?.hasVideo ? 'visible' : 'hidden' }}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerUp={onPointer}
        />
      </div>

      {connected && (
        <nav className="rail" onMouseDown={(e) => e.stopPropagation()}>
          <div className="rail-info">
            <div className="ltr num" style={{ color: '#eef6f3', fontWeight: 700 }}>{formatId(peerId)}</div>
            {state?.delay != null && <div className="ltr num">{state.delay}ms</div>}
            <div className="ltr num">{state?.fps ?? 0} fps</div>
            {state?.codec && <div className="ltr num">{state.codec}</div>}
          </div>
          <div className="rail-sep" />
          <button className={`rail-btn${panel === 'display' ? ' open' : ''}`} title={t('rail_display_settings')} onClick={() => setPanel(panel === 'display' ? null : 'display')}>
            <Icon name="tune" size={20} />
          </button>
          <button className={`rail-btn${panel === 'keys' ? ' open' : ''}`} title={t('rail_keys')} onClick={() => setPanel(panel === 'keys' ? null : 'keys')} disabled={!state?.keyboard}>
            <Icon name="keyboard" size={20} />
          </button>
          <button className="rail-btn" title={t('rail_refresh')} onClick={() => sessionRef.current?.refresh()}>
            <Icon name="refresh" size={20} />
          </button>
          <button className="rail-btn" title={t('rail_fullscreen')} onClick={toggleFullscreen}>
            <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={20} />
          </button>
          <div className="rail-sep" />
          <button className="rail-btn danger" title={t('rail_disconnect')} onClick={disconnect}>
            <Icon name="power" size={20} />
          </button>
        </nav>
      )}

      {connected && panel === 'display' && peer && (
        <div className="rail-panel">
          <h4>{t('rail_display_settings')}</h4>
          {peer.displays.length > 1 && (
            <>
              <span className="label">{t('rail_displays')}</span>
              <div className="rail-seg">
                {peer.displays.map((_, i) => (
                  <button key={i} className={peer.current === i ? 'on' : ''} onClick={() => sessionRef.current?.switchDisplay(i)}>
                    {t('display_n', i + 1)}
                  </button>
                ))}
              </div>
            </>
          )}
          <span className="label">{t('asan_scale')}</span>
          <div className="rail-seg">
            <button className={fit ? 'on' : ''} onClick={() => setFit(true)}>{t('asan_fit')}</button>
            <button className={!fit ? 'on' : ''} onClick={() => setFit(false)}>{t('asan_actual_size')}</button>
          </div>
          <span className="label">{t('quality')}</span>
          <div className="rail-seg">
            {(['speed', 'balanced', 'best'] as Quality[]).map((q) => (
              <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>
                {t(q === 'speed' ? 'asan_q_speed' : q === 'best' ? 'asan_q_best' : 'asan_q_balanced')}
              </button>
            ))}
          </div>
        </div>
      )}

      {connected && panel === 'keys' && (
        <div className="rail-panel">
          <h4>{t('rail_keys')}</h4>
          <button className="rail-row" onClick={() => sessionRef.current?.sendCtrlAltDel()}>
            <Icon name="keyboard" size={18} />
            <span className="ltr">{t('ctrl_alt_del')}</span>
          </button>
          <button className="rail-row" onClick={() => sessionRef.current?.sendLockScreen()}>
            <Icon name="lock" size={18} />
            {t('lock_screen')}
          </button>
          <button className="rail-row" onClick={() => setPanel('text')}>
            <Icon name="send" size={18} />
            {t('type_text')}
          </button>
        </div>
      )}

      {connected && panel === 'text' && (
        <TypeTextPanel
          onSend={(text) => {
            sessionRef.current?.sendText(text);
            setPanel(null);
            stageRef.current?.focus();
          }}
          onCancel={() => setPanel(null)}
        />
      )}

      {connected && !state?.hasVideo && (
        <div className="session-overlay" style={{ pointerEvents: 'none' }}>
          <div className="session-card">
            <AsanLoader small label={t(state?.videoStalled ? 'st_no_video' : 'st_waiting_video')} />
            {state?.videoStalled && <p style={{ fontSize: 12.5 }}>{t('st_no_video_hint')}</p>}
          </div>
        </div>
      )}
      {connected && !state?.keyboard && <div className="session-hint">{t('view_only_peer')}</div>}
      {connected && state?.keyboard && !focused && panel === null && <div className="session-hint">{t('focus_hint')}</div>}

      {state && state.phase !== 'connected' && (
        <div className="session-overlay">
          <SessionCard
            state={state}
            name={name}
            peerId={peerId}
            onPassword={(pw, remember) => void sessionRef.current?.submitPassword(pw, remember)}
            on2fa={(code) => sessionRef.current?.submit2fa(code)}
            onRetry={() => setAttempt((a) => a + 1)}
            onExit={disconnect}
          />
        </div>
      )}
    </div>
  );
}

function SessionCard({
  state, name, peerId, onPassword, on2fa, onRetry, onExit,
}: {
  state: SessionState;
  name: string;
  peerId: string;
  onPassword: (pw: string, remember: boolean) => void;
  on2fa: (code: string) => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState('');

  if (state.phase === 'password') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (pw) onPassword(pw, remember);
      setPw('');
    };
    return (
      <form className="session-card" onSubmit={submit} style={{ alignItems: 'stretch', textAlign: 'start' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="key" size={20} style={{ color: '#3ec08d' }} />
          {t('asan_pw_title')}
        </h3>
        <p>
          {t('asan_pw_for')} <b className="ltr">{formatId(peerId)}</b>
        </p>
        <p>{t('asan_pw_sub')}</p>
        <PasswordInput value={pw} onChange={setPw} placeholder={t('asan_pw_hint')} autoFocus bad={state.passwordError} autoComplete="off" />
        {state.passwordError && <div style={{ color: '#f2727d', fontSize: 12.5 }}>{t('err_wrong_password')}</div>}
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('remember_password')}
        </label>
        <p style={{ fontSize: 12 }}>{t('pw_or_wait')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onExit}>{t('cancel')}</button>
          <button className="btn primary" disabled={!pw}>{t('connect')}</button>
        </div>
      </form>
    );
  }

  if (state.phase === '2fa') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (code) on2fa(code.trim());
      setCode('');
    };
    return (
      <form className="session-card" onSubmit={submit} style={{ alignItems: 'stretch', textAlign: 'start' }}>
        <h3>{t('twofa_title')}</h3>
        <p>{state.message === 'err_2fa_wrong' ? t('err_2fa_wrong') : t('twofa_sub')}</p>
        <input className="input ltr num" dir="ltr" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoFocus maxLength={8} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onExit}>{t('cancel')}</button>
          <button className="btn primary" disabled={!code}>{t('ok')}</button>
        </div>
      </form>
    );
  }

  if (state.phase === 'closed') {
    return (
      <div className="session-card">
        <Icon name={state.message === 'st_closed_by_me' ? 'info' : 'warning'} size={34} style={{ color: '#f2727d' }} />
        <h3>{t(state.message)}</h3>
        {state.detail && <p className="ltr">{state.detail}</p>}
        <div className="peer">{name}</div>
        <div className="row">
          <button className="btn" onClick={onExit}>{t('back_home')}</button>
          <button className="btn primary" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            {t('reconnect')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-card">
      <AsanLoader small label={t(state.message || 'st_connecting')} />
      {state.phase === 'approval' && <p>{t('st_approval_sub')}</p>}
      <div className="peer">{formatId(peerId)}</div>
      <button className="btn" onClick={onExit}>{t('cancel')}</button>
    </div>
  );
}

function TypeTextPanel({ onSend, onCancel }: { onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="rail-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(text);
      }}
    >
      <h4>{t('type_text')}</h4>
      <span className="label">{t('type_text_sub')}</span>
      <textarea className="input" style={{ height: 90, padding: 10, resize: 'none' }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn small" onClick={onCancel}>{t('cancel')}</button>
        <button className="btn small primary" disabled={!text}>
          <Icon name="send" size={15} />
          {t('send')}
        </button>
      </div>
    </form>
  );
}
