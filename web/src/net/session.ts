// جلسهٔ کنترل یک دستگاه از مرورگر (طرف «کنترل‌کننده»): ورود، تصویر، موس و کیبورد
import type { WebConfig } from '../api';
import { b64decode, b64encode, loginHash, passwordH1 } from './crypto';
import { ctrlAltDel, keyEventsFor, lockScreen, modifiersOf, typeText } from './keys';
import { ConnectError, connectToPeer } from './rendezvous';
import { WsTransport } from './transport';
import { BoolOption, ImageQuality, PROTOCOL_VERSION, Permission, PreferCodec, type Msg } from './proto';
import { VideoSink, decodeAbility } from './video';
import { alog } from '../log';

export type SessionPhase =
  | 'connecting'
  | 'login'
  | 'password'
  | 'approval'
  | '2fa'
  | 'connected'
  | 'closed';

export interface DisplayGeom {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export interface PeerSummary {
  hostname: string;
  username: string;
  platform: string;
  version: string;
  displays: DisplayGeom[];
  current: number;
}

export interface SessionState {
  phase: SessionPhase;
  /** کلید پیام i18n برای خطا یا وضعیت */
  message: string;
  detail: string;
  passwordError: boolean;
  peer: PeerSummary | null;
  keyboard: boolean;
  delay: number | null;
  fps: number;
  /** نام کدک تصویر (VP9، AV1، …) برای نوار کناری */
  codec: string;
  /** اولین فریم تصویر رسیده و کشیده شده */
  hasVideo: boolean;
  /** چند بار درخواست تصویر داده شد و هنوز چیزی نرسیده */
  videoStalled: boolean;
}

export type Quality = 'speed' | 'balanced' | 'best';

const MOUSE = { MOVE: 0, DOWN: 1, UP: 2, WHEEL: 3 } as const;
const BUTTON: Record<number, number> = { 0: 0x01, 1: 0x04, 2: 0x02, 3: 0x08, 4: 0x10 };

const LOGIN_ERRORS: Record<string, string> = {
  'Wrong Password': 'err_wrong_password',
  'Empty Password': 'err_wrong_password',
  'Too many wrong attempts': 'err_too_many',
  'Please try 1 minute later': 'err_too_many',
  'Connection not allowed': 'err_not_allowed',
  'Your ip is blocked by the peer': 'err_ip_blocked',
  'Your ID is blocked by the peer': 'err_id_blocked',
  'The main window is not open': 'err_main_window',
  'Offline': 'err_offline',
  'Wrong 2FA Code': 'err_2fa_wrong',
};

function rememberKey(peerId: string) {
  return `asw_pw_${peerId}`;
}

function geom(d: Msg): DisplayGeom {
  return { x: d.x || 0, y: d.y || 0, width: d.width || 0, height: d.height || 0, name: d.name || '' };
}

export class RemoteSession {
  state: SessionState = {
    phase: 'connecting', message: 'st_connecting', detail: '', passwordError: false, peer: null,
    keyboard: true, delay: null, fps: 0, codec: '', hasVideo: false, videoStalled: false,
  };
  private noVideoChecks = 0;
  private conn: WsTransport | null = null;
  private video: VideoSink;
  private hash: { salt: string; challenge: string } | null = null;
  private sessionId = Math.floor(Math.random() * 2 ** 52);
  private listeners = new Set<(s: SessionState) => void>();
  private timers: number[] = [];
  private lastFrames = 0;
  private pendingMove: { x: number; y: number; mods: number[] } | null = null;
  private wheelAcc = 0;
  private quality: Quality = 'balanced';
  private remember = false;
  private h1: Uint8Array | null = null;

  private cfg: WebConfig;
  peerId: string;
  private me: { webId: string; name: string };

  constructor(cfg: WebConfig, peerId: string, me: { webId: string; name: string }, canvas: HTMLCanvasElement) {
    this.cfg = cfg;
    this.peerId = peerId;
    this.me = me;
    this.video = new VideoSink(canvas);
    this.video.onNeedKeyframe = () => this.conn?.send({ misc: { refresh_video: true } });
    this.video.onFatal = () => this.fail('err_codec');
    this.video.onSize = () => {
      if (!this.state.hasVideo || this.state.codec !== this.video.codecName) {
        this.set({ hasVideo: true, videoStalled: false, codec: this.video.codecName });
      }
    };
  }

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private fail(message: string, detail = '') {
    if (this.state.phase === 'closed') return;
    this.set({ phase: 'closed', message, detail });
    this.cleanup();
  }

  async start() {
    try {
      this.conn = await connectToPeer(this.cfg, this.peerId);
    } catch (e) {
      if (e instanceof ConnectError) this.fail(e.key, e.message !== e.key ? e.message : '');
      else this.fail('err_other', String(e));
      return;
    }
    if (this.state.phase === 'closed') {
      this.conn.close();
      return;
    }
    this.set({ phase: 'login', message: 'st_login' });
    this.conn.onClose = () => {
      if (this.state.phase !== 'closed') this.fail(this.state.phase === 'connected' ? 'st_peer_closed' : 'err_other');
    };
    this.conn.listen((m) => this.onMessage(m).catch(() => undefined));
    // تا ورود کامل نشده رله بی‌پیام نماند (hbbr اتصال بی‌ترافیک را بعد از ۳۰ ثانیه می‌بندد)
    this.every(10_000, () => {
      if (this.state.phase !== 'connected') this.conn?.send({ test_delay: { time: Date.now(), from_client: true } });
    });
    this.every(1000, () => {
      const fps = this.video.frames - this.lastFrames;
      this.lastFrames = this.video.frames;
      if (fps !== this.state.fps) this.set({ fps });
    });
    this.every(3000, () => this.checkVideo());
  }

  /** وصل شده‌ایم ولی تصویری کشیده نشده: دوباره فریم کلیدی می‌خواهیم و وضعیت را در لاگ (همراه بازخورد) می‌نویسیم */
  private checkVideo() {
    if (this.state.phase !== 'connected' || this.video.frames > 0) return;
    this.noVideoChecks += 1;
    const v = this.video;
    alog('video: nothing drawn yet', `${this.noVideoChecks * 3}s`, `codec=${v.codecName || '-'}`, `chunks=${v.chunks}`, `keys=${v.keys}`);
    if (this.noVideoChecks <= 5) this.conn?.send({ misc: { refresh_video: true } });
    if (this.noVideoChecks === 5) this.set({ videoStalled: true });
  }

  private every(ms: number, fn: () => void) {
    this.timers.push(window.setInterval(fn, ms));
  }

  private async onMessage(m: Msg) {
    switch (m.union) {
      case 'hash':
        this.hash = { salt: m.hash.salt || '', challenge: m.hash.challenge || '' };
        await this.loginWithRemembered();
        break;
      case 'login_response':
        this.onLoginResponse(m.login_response);
        break;
      case 'video_frame':
        this.video.push(m.video_frame);
        break;
      case 'test_delay': {
        const t = m.test_delay;
        if (!t.from_client) {
          this.conn?.send({ test_delay: t });
          if (t.last_delay) this.set({ delay: t.last_delay });
        } else if (t.time) {
          this.set({ delay: Math.max(0, Date.now() - Number(t.time)) });
        }
        break;
      }
      case 'peer_info':
        this.onPeerInfo(m.peer_info);
        break;
      case 'misc':
        this.onMisc(m.misc);
        break;
      case 'message_box':
        alog('peer message', m.message_box?.msgtype || '', m.message_box?.title || '', m.message_box?.text || '');
        if (m.message_box?.msgtype?.includes('error')) this.fail('err_other', m.message_box.text || '');
        break;
      default:
        break;
    }
  }

  private async loginWithRemembered() {
    let h1: Uint8Array | null = this.h1;
    if (!h1) {
      try {
        const saved = JSON.parse(localStorage.getItem(rememberKey(this.peerId)) || 'null');
        if (saved && saved.salt === this.hash?.salt) h1 = b64decode(saved.h1);
      } catch {
        /* حافظهٔ مرورگر در دسترس نیست */
      }
    }
    await this.sendLogin(h1);
    if (!h1) this.set({ phase: 'password', message: 'st_password', passwordError: false });
  }

  private async sendLogin(h1: Uint8Array | null) {
    if (!this.hash || !this.conn) return;
    const password = h1 ? await loginHash(h1, this.hash.challenge) : new Uint8Array();
    const ability = await decodeAbility();
    this.conn.send({
      login_request: {
        username: this.peerId,
        password,
        my_id: this.me.webId,
        my_name: this.me.name,
        my_platform: 'Web',
        version: PROTOCOL_VERSION,
        session_id: this.sessionId,
        option: {
          image_quality: this.qualityValue(),
          disable_audio: BoolOption.Yes,
          disable_clipboard: BoolOption.Yes,
          supported_decoding: {
            ability_vp9: ability.vp9 ? 1 : 0,
            ability_vp8: ability.vp8 ? 1 : 0,
            ability_av1: ability.av1 ? 1 : 0,
            ability_h264: ability.h264 ? 1 : 0,
            ability_h265: 0,
            // بی‌ترجیح، دستگاه مقابل وقتی همه AV1 بخوانند AV1 می‌فرستد؛ VP9 همان کدکی است که در هر دو جهت
            // آزموده شده (طرف مقابل همیشه VP9 نرم‌افزاری دارد)
            prefer: PreferCodec.VP9,
          },
        },
      },
    });
  }

  async submitPassword(password: string, remember: boolean) {
    if (!this.hash) return;
    this.remember = remember;
    this.h1 = await passwordH1(password, this.hash.salt);
    this.set({ phase: 'login', message: 'st_login', passwordError: false });
    await this.sendLogin(this.h1);
  }

  submit2fa(code: string) {
    this.set({ phase: 'login', message: 'st_login' });
    this.conn?.send({ auth_2fa: { code } });
  }

  private onLoginResponse(lr: Msg) {
    if (lr.union === 'error') {
      const err: string = lr.error || '';
      if (err === 'No Password Access') {
        this.set({ phase: 'approval', message: 'st_approval' });
        return;
      }
      if (err === '2FA Required' || err === 'Wrong 2FA Code') {
        this.set({ phase: '2fa', message: err === '2FA Required' ? 'st_2fa' : 'err_2fa_wrong' });
        return;
      }
      if (err === 'Wrong Password' || err === 'Empty Password') {
        try {
          localStorage.removeItem(rememberKey(this.peerId));
        } catch {
          /* ignore */
        }
        this.h1 = null;
        this.set({ phase: 'password', message: 'err_wrong_password', passwordError: true });
        return;
      }
      this.fail(LOGIN_ERRORS[err] || 'err_other', LOGIN_ERRORS[err] ? '' : err);
      return;
    }
    if (lr.union === 'peer_info') {
      if (this.h1 && this.remember && this.hash) {
        try {
          localStorage.setItem(rememberKey(this.peerId), JSON.stringify({ salt: this.hash.salt, h1: b64encode(this.h1) }));
        } catch {
          /* ignore */
        }
      }
      const pi = lr.peer_info;
      const dims = (pi.displays || []).map((d: Msg) => `${d.width}x${d.height}`).join(',');
      alog('peer', pi.platform || '-', pi.version || '-', `displays=${dims}`, `current=${pi.current_display || 0}`, `encoding=${JSON.stringify(pi.encoding ?? null)}`);
      this.onPeerInfo(pi);
      this.set({ phase: 'connected', message: '' });
      // ویندوزی با چند نشست (RDP): دستگاه مقابل تا انتخاب نشست تصویری نمی‌فرستد؛ برنامهٔ دسکتاپ می‌پرسد، ما همان نشست فعلی را می‌خواهیم
      const sessions = pi.windows_sessions?.sessions || [];
      if (sessions.length > 1) {
        alog('peer windows sessions', sessions.length, 'picking current', pi.windows_sessions.current_sid);
        this.conn?.send({ misc: { selected_sid: pi.windows_sessions.current_sid || 0 } });
      }
      this.conn?.send({ misc: { refresh_video: true } });
    }
  }

  private onPeerInfo(pi: Msg) {
    const displays: DisplayGeom[] = (pi.displays || []).map(geom);
    this.set({
      peer: {
        hostname: pi.hostname || '',
        username: pi.username || '',
        platform: pi.platform || '',
        version: pi.version || '',
        displays,
        current: Math.min(pi.current_display || 0, Math.max(0, displays.length - 1)),
      },
    });
  }

  private onMisc(misc: Msg) {
    switch (misc.union) {
      case 'switch_display': {
        const sd = misc.switch_display;
        const peer = this.state.peer;
        if (!peer) return;
        const displays = [...peer.displays];
        const i = sd.display || 0;
        displays[i] = { ...geom(sd), name: displays[i]?.name || '' };
        this.set({ peer: { ...peer, displays, current: i } });
        break;
      }
      case 'permission_info':
        if (misc.permission_info.permission === Permission.Keyboard) {
          this.set({ keyboard: !!misc.permission_info.enabled });
        }
        break;
      case 'close_reason':
        this.fail('st_peer_closed', misc.close_reason || '');
        break;
      default:
        break;
    }
  }

  // ---------- ورودی ----------

  private get display(): DisplayGeom | null {
    const p = this.state.peer;
    return p ? p.displays[p.current] || null : null;
  }

  private canInput(): boolean {
    return this.state.phase === 'connected' && this.state.keyboard && !!this.conn;
  }

  /** مختصات نقطه‌ای از canvas (بین ۰ و ۱) → مختصات صفحهٔ دستگاه مقصد */
  private toRemote(fx: number, fy: number): { x: number; y: number } | null {
    const d = this.display;
    if (!d || d.width <= 0) return null;
    return {
      x: Math.round(d.x + Math.min(Math.max(fx, 0), 1) * (d.width - 1)),
      y: Math.round(d.y + Math.min(Math.max(fy, 0), 1) * (d.height - 1)),
    };
  }

  mouseMove(fx: number, fy: number, e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
    if (!this.canInput()) return;
    const p = this.toRemote(fx, fy);
    if (!p) return;
    const first = this.pendingMove === null;
    this.pendingMove = { ...p, mods: modifiersOf(e) };
    if (first) {
      requestAnimationFrame(() => {
        const mv = this.pendingMove;
        this.pendingMove = null;
        if (mv) this.conn?.send({ mouse_event: { mask: MOUSE.MOVE, x: mv.x, y: mv.y, modifiers: mv.mods } });
      });
    }
  }

  mouseButton(fx: number, fy: number, button: number, down: boolean, e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
    if (!this.canInput()) return;
    const p = this.toRemote(fx, fy);
    const b = BUTTON[button];
    if (!p || b === undefined) return;
    this.pendingMove = null;
    this.conn?.send({ mouse_event: { mask: (down ? MOUSE.DOWN : MOUSE.UP) | (b << 3), x: p.x, y: p.y, modifiers: modifiersOf(e) } });
  }

  wheel(deltaX: number, deltaY: number, deltaMode: number, e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
    if (!this.canInput()) return;
    // هر «پله» چرخ موس حدود ۱۰۰ پیکسل؛ تاچ‌پد پیکسل‌های کوچک‌تر می‌فرستد که جمع می‌شوند
    const step = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
    this.wheelAcc += step;
    const notches = Math.trunc(this.wheelAcc / 100);
    if (notches !== 0) {
      this.wheelAcc -= notches * 100;
      const n = Math.max(-10, Math.min(10, notches));
      for (let i = 0; i < Math.abs(n); i++) {
        this.conn?.send({ mouse_event: { mask: MOUSE.WHEEL, x: 0, y: n > 0 ? -1 : 1, modifiers: modifiersOf(e) } });
      }
    }
    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
      this.conn?.send({ mouse_event: { mask: MOUSE.WHEEL, x: deltaX > 0 ? -1 : 1, y: 0, modifiers: modifiersOf(e) } });
    }
  }

  key(e: KeyboardEvent, down: boolean): boolean {
    if (!this.canInput()) return false;
    const msgs = keyEventsFor(e, down);
    for (const m of msgs) this.conn?.send(m);
    return true;
  }

  sendText(text: string) {
    if (this.canInput() && text) this.conn?.send(typeText(text));
  }

  sendCtrlAltDel() {
    if (this.canInput()) this.conn?.send(ctrlAltDel(this.state.peer?.platform || ''));
  }

  sendLockScreen() {
    if (this.canInput()) this.conn?.send(lockScreen());
  }

  // ---------- تنظیمات جلسه ----------

  private qualityValue(): number {
    return this.quality === 'speed' ? ImageQuality.Low : this.quality === 'best' ? ImageQuality.Best : ImageQuality.Balanced;
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.conn?.send({ misc: { option: { image_quality: this.qualityValue() } } });
  }

  switchDisplay(i: number) {
    const peer = this.state.peer;
    if (!peer || i === peer.current || !peer.displays[i]) return;
    this.conn?.send({ misc: { switch_display: { display: i } } });
    this.set({ peer: { ...peer, current: i } });
  }

  refresh() {
    this.conn?.send({ misc: { refresh_video: true } });
  }

  close() {
    if (this.state.phase !== 'closed') {
      this.conn?.send({ misc: { close_reason: 'Closed by the remote side' } });
    }
    this.set({ phase: 'closed', message: 'st_closed_by_me' });
    this.cleanup();
  }

  private cleanup() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.video.close();
    const conn = this.conn;
    this.conn = null;
    if (conn) {
      conn.onClose = null;
      // پیام خداحافظی قبل از بستن برود
      setTimeout(() => conn.close(), 100);
    }
  }
}
