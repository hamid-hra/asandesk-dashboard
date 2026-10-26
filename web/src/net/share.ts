// اشتراک صفحه از مرورگر (طرف «کنترل‌شونده»؛ فقط مشاهده)
//
// درگاه وب (webgw) کد این حساب را در سرور شناسه ثبت کرده است. وقتی کسی (برنامهٔ دسکتاپ یا وب) این کد را
// وارد کند، درگاه uuid رله را به ما می‌دهد و این فایل همان کاری را می‌کند که برنامهٔ دسکتاپ در
// src/server.rs (identity_handshake) و src/server/connection.rs می‌کند: امضای هویت، گرفتن کلید، بررسی
// رمز یک‌بارمصرف، تأیید کاربر و فرستادن تصویر صفحه با WebCodecs. موس و کیبورد از مرورگر شبیه‌سازی
// نمی‌شوند، پس اجازهٔ کیبورد همیشه خاموش اعلام می‌شود.
import type { WebConfig } from '../api';
import {
  KX_VERSION_LATEST, StreamCipher, boxKeyPair, constantTimeEqual, loginHash, openKey, passwordH1, randomBytes,
  signCombined, signKeyPairFromSeed, b64decode,
} from './crypto';
import { relayWsUrl } from './rendezvous';
import { WsTransport } from './transport';
import { ConnType, ImageQuality, PROTOCOL_VERSION, Permission, encodeIdPk, type Msg } from './proto';

export interface Identity {
  webId: string;
  seed: string;
  name: string;
}

export interface IncomingRequest {
  key: number;
  peerId: string;
  peerName: string;
  platform: string;
}

export interface Viewer {
  key: number;
  peerId: string;
  peerName: string;
  since: number;
}

export interface ShareCallbacks {
  /** کسی می‌خواهد صفحه را ببیند (با رمز یک‌بارمصرف یا بی‌رمز) و منتظر تأیید است */
  onRequest(req: IncomingRequest): void;
  onRequestGone(key: number): void;
  onViewers(viewers: Viewer[]): void;
  /** بیننده‌ای وصل شد (برای گزارش اتصال به داشبورد)؛ `key` شمارهٔ همین اتصال است */
  onLog?(direction: 'in', peerId: string, peerName: string, key: number): Promise<number | null>;
  onLogEnd?(id: number | null, key: number): void;
  onError?(messageKey: string): void;
}

const OTP_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const FPS = 15;
const APPROVAL_TIMEOUT_MS = 60_000;

function randomString(n: number, chars = OTP_CHARS): string {
  return Array.from(randomBytes(n), (b) => chars[b % chars.length]).join('');
}

// «تنظیمات من را به یاد داشته باش»: صفحهٔ انتخاب‌شده بعد از پایان اتصال نگه داشته می‌شود و نوعش (کل صفحه،
// پنجره، زبانه) ذخیره می‌شود تا بعد از بارگذاری دوباره، انتخاب‌گر مرورگر روی همان نوع باز شود. مرورگرها اجازه
// نمی‌دهند خود پنجره بعد از بستن صفحه به یاد بماند.
const REMEMBER_KEY = 'asw_share_remember';
const SURFACE_KEY = 'asw_share_surface';

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* حافظهٔ مرورگر در دسترس نیست */
  }
}

export function shareRemembered(): boolean {
  return readLocal(REMEMBER_KEY) === '1';
}

export function shareSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof window !== 'undefined' &&
    'VideoEncoder' in window
  );
}

async function pickCodec(width: number, height: number): Promise<{ key: 'vp9s' | 'vp8s'; codec: string } | null> {
  for (const c of [
    { key: 'vp9s' as const, codec: 'vp09.00.10.08' },
    { key: 'vp8s' as const, codec: 'vp8' },
  ]) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: 2_000_000, framerate: FPS });
      if (r.supported) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

/** اندازهٔ تصویر ارسالی: حداکثر ۱۹۲۰×۱۲۰۰ با همان نسبت، زوج */
function targetSize(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
  return { width: Math.max(2, Math.round((w * scale) / 2) * 2), height: Math.max(2, Math.round((h * scale) / 2) * 2) };
}

type FrameSource = { stop(): void };

/** هر فریم صفحه را به `onFrame` می‌دهد؛ در کروم با MediaStreamTrackProcessor (در پس‌زمینه هم کار می‌کند) */
function frameSource(track: MediaStreamTrack, video: HTMLVideoElement, onFrame: (f: VideoFrame) => void): FrameSource {
  let stopped = false;
  const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor;
  if (Processor) {
    const own = track.clone();
    const reader = new Processor({ track: own }).readable.getReader();
    const loop = async () => {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        if (stopped) {
          value.close();
          break;
        }
        onFrame(value);
      }
    };
    loop().catch(() => undefined);
    return {
      stop() {
        stopped = true;
        reader.cancel().catch(() => undefined);
        own.stop();
      },
    };
  }
  const timer = window.setInterval(() => {
    if (stopped || video.readyState < 2 || !video.videoWidth) return;
    try {
      onFrame(new VideoFrame(video, { timestamp: Math.round(performance.now() * 1000) }));
    } catch {
      /* frame not ready */
    }
  }, Math.round(1000 / FPS));
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** یک بیننده: رمزگذار و اتصال خودش */
class ViewerLink {
  private encoder: VideoEncoder | null = null;
  private codec: { key: 'vp9s' | 'vp8s'; codec: string } | null = null;
  private size = { width: 0, height: 0 };
  private source: FrameSource | null = null;
  private canvas = document.createElement('canvas');
  private lastFrameAt = 0;
  private forceKey = true;
  private framesSinceKey = 0;
  private quality = ImageQuality.Balanced as number;
  private timers: number[] = [];
  closed = false;

  private conn: WsTransport;
  private onClosed: () => void;

  constructor(conn: WsTransport, onClosed: () => void) {
    this.conn = conn;
    this.onClosed = onClosed;
  }

  async start(stream: MediaStream, video: HTMLVideoElement) {
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const w = settings.width || video.videoWidth || 1280;
    const h = settings.height || video.videoHeight || 720;
    this.size = targetSize(w, h);
    this.codec = await pickCodec(this.size.width, this.size.height);
    if (!this.codec) throw new Error('no encoder');
    this.configure();
    this.source = frameSource(track, video, (f) => this.onFrame(f));
    this.timers.push(window.setInterval(() => this.conn.send({ test_delay: { time: Date.now(), from_client: false } }), 3000));
  }

  get displayInfo() {
    return {
      x: 0, y: 0, width: this.size.width, height: this.size.height, name: 'Screen', online: true, cursor_embedded: true,
      original_resolution: { width: this.size.width, height: this.size.height }, scale: 1,
    };
  }

  get codecKey() {
    return this.codec?.key ?? 'vp9s';
  }

  private bitrate(): number {
    const base = (this.size.width * this.size.height * FPS) / 15; // ~۲ مگابیت برای ۱۰۸۰p
    const factor = this.quality === ImageQuality.Low ? 0.5 : this.quality === ImageQuality.Best ? 1.8 : 1;
    return Math.max(300_000, Math.round(base * factor));
  }

  private configure() {
    if (!this.codec) return;
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    this.encoder = new VideoEncoder({
      output: (chunk) => this.onChunk(chunk),
      error: () => {
        this.forceKey = true;
        setTimeout(() => !this.closed && this.configure(), 200);
      },
    });
    this.encoder.configure({
      codec: this.codec.codec,
      width: this.size.width,
      height: this.size.height,
      bitrate: this.bitrate(),
      framerate: FPS,
      latencyMode: 'realtime',
    });
    this.forceKey = true;
  }

  private onFrame(frame: VideoFrame) {
    try {
      if (this.closed || !this.encoder || this.encoder.state !== 'configured') return;
      const now = performance.now();
      if (now - this.lastFrameAt < 1000 / FPS - 2) return;
      // شبکه یا رمزگذار عقب افتاده: فریم دور ریخته می‌شود (نه انباشته)
      if (this.conn.bufferedAmount > 1_500_000 || this.encoder.encodeQueueSize > 2) return;
      this.lastFrameAt = now;
      const want = targetSize(frame.displayWidth, frame.displayHeight);
      if (want.width !== this.size.width || want.height !== this.size.height) {
        this.size = want;
        this.configure();
        this.conn.send({ misc: { switch_display: { display: 0, ...this.displayInfo } } });
      }
      let input = frame;
      let scaled: VideoFrame | null = null;
      if (frame.displayWidth !== this.size.width || frame.displayHeight !== this.size.height) {
        this.canvas.width = this.size.width;
        this.canvas.height = this.size.height;
        this.canvas.getContext('2d')?.drawImage(frame, 0, 0, this.size.width, this.size.height);
        scaled = new VideoFrame(this.canvas, { timestamp: frame.timestamp });
        input = scaled;
      }
      const keyFrame = this.forceKey || this.framesSinceKey >= FPS * 5;
      this.forceKey = false;
      this.framesSinceKey = keyFrame ? 0 : this.framesSinceKey + 1;
      this.encoder.encode(input, { keyFrame });
      scaled?.close();
    } catch {
      this.forceKey = true;
    } finally {
      frame.close();
    }
  }

  private onChunk(chunk: EncodedVideoChunk) {
    if (this.closed || !this.codec) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.conn.send({
      video_frame: {
        [this.codec.key]: { frames: [{ data, key: chunk.type === 'key', pts: Math.round(chunk.timestamp / 1000) }] },
        display: 0,
      },
    });
  }

  requestKeyframe() {
    this.forceKey = true;
  }

  setQuality(q: number) {
    if (!q || q === this.quality) return;
    this.quality = q;
    this.configure();
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.source?.stop();
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    this.conn.close();
    this.onClosed();
  }
}

/** یک اتصال ورودی از دست‌دادن تا پایان */
class Incoming {
  private hash = { salt: randomString(8), challenge: randomString(8) };
  private failures = 0;
  private approved = false;
  private link: ViewerLink | null = null;
  private keepalive = 0;
  private approvalTimer = 0;
  private logId: number | null = null;
  private logged = false;
  request: IncomingRequest | null = null;
  done = false;

  key: number;
  private host: ShareHost;
  private conn: WsTransport;

  constructor(key: number, host: ShareHost, conn: WsTransport) {
    this.key = key;
    this.host = host;
    this.conn = conn;
  }

  async run(identity: { webId: string; signSk: Uint8Array }) {
    // هویت: IdPk امضاشده با کلید Ed25519 حساب (همان که درگاه در hbbs ثبت کرده)
    const box = boxKeyPair();
    const idpk = encodeIdPk({ id: identity.webId, pk: box.publicKey, kx_version: KX_VERSION_LATEST });
    this.conn.send({ signed_id: { id: signCombined(idpk, identity.signSk) } });
    const reply = await this.conn.nextMessage(18000);
    const pk = reply.public_key;
    if (!pk || !pk.asymmetric_value || pk.asymmetric_value.length !== 32) {
      // کنترل‌کننده‌ای که رمزنگاری نمی‌کند پذیرفته نمی‌شود
      throw new Error('insecure controller');
    }
    const key = openKey(pk.symmetric_value, pk.asymmetric_value, box.secretKey);
    const picked = pk.kx_version || 0;
    if (!key || picked > KX_VERSION_LATEST) throw new Error('handshake failed');
    this.conn.setCipher(
      StreamCipher.negotiated(key, false, {
        initiatorPk: pk.asymmetric_value,
        responderPk: box.publicKey,
        advertised: KX_VERSION_LATEST,
        picked,
      }),
    );
    this.conn.onClose = () => this.finish();
    this.conn.listen((m) => this.onMessage(m).catch(() => this.finish()));
    this.conn.send({ hash: this.hash });
    // تا تأیید و انتخاب صفحه، رله بی‌ترافیک نماند
    this.keepalive = window.setInterval(() => {
      if (!this.approved) this.conn.send({ test_delay: { time: Date.now(), from_client: false } });
    }, 10_000);
  }

  private async onMessage(m: Msg) {
    switch (m.union) {
      case 'login_request':
        await this.onLogin(m.login_request);
        break;
      case 'test_delay':
        if (m.test_delay.from_client) this.conn.send({ test_delay: m.test_delay });
        break;
      case 'misc': {
        const misc = m.misc;
        if (misc.union === 'refresh_video' || misc.union === 'refresh_video_display') this.link?.requestKeyframe();
        else if (misc.union === 'option') this.link?.setQuality(misc.option.image_quality);
        else if (misc.union === 'close_reason') this.finish();
        break;
      }
      default:
        break; // موس، کیبورد و بقیه: از مرورگر شدنی نیست
    }
  }

  private async onLogin(lr: Msg) {
    if (lr.union) {
      // انتقال فایل، ترمینال، دوربین و تونل از مرورگر شدنی نیست
      this.loginError('Not supported in AsanDesk Web');
      return;
    }
    // مثل برنامهٔ دسکتاپ (رمز یا تأیید با کلیک): بی‌رمز همان لحظه درخواست به کاربر نشان داده می‌شود و
    // کنترل‌کننده هم‌زمان می‌تواند رمز یک‌بارمصرف را وارد کند. در هر حال کاربر باید «اجازه» را بزند، چون
    // مرورگر انتخاب صفحه را فقط با کلیک او باز می‌کند.
    const password: Uint8Array = lr.password || new Uint8Array();
    if (password.length > 0) {
      const expected = await loginHash(await passwordH1(this.host.otp, this.hash.salt), this.hash.challenge);
      if (!constantTimeEqual(expected, password)) {
        this.failures += 1;
        if (this.failures >= 3) {
          this.loginError('Too many wrong attempts');
          setTimeout(() => this.finish(), 500);
        } else {
          this.loginError('Wrong Password');
        }
        return;
      }
    }
    if (this.request) return; // درخواست همین اتصال روی صفحه است
    this.request = {
      key: this.key,
      peerId: String(lr.my_id || '').split('@')[0],
      peerName: lr.my_name || '',
      platform: lr.my_platform || '',
    };
    this.host.raiseRequest(this.request);
    this.approvalTimer = window.setTimeout(() => this.reject(), APPROVAL_TIMEOUT_MS);
  }

  private loginError(error: string) {
    this.conn.send({ login_response: { error } });
  }

  /** کاربر «اجازه» را زد و صفحه را انتخاب کرد */
  async accept(stream: MediaStream, video: HTMLVideoElement, name: string) {
    clearTimeout(this.approvalTimer);
    if (this.done) return;
    this.approved = true;
    const link = new ViewerLink(this.conn, () => this.finish());
    this.link = link;
    try {
      await link.start(stream, video);
    } catch {
      this.loginError('Connection not allowed');
      this.host.reportError('share_err_encoder');
      this.finish();
      return;
    }
    this.conn.send({
      login_response: {
        peer_info: {
          username: name,
          hostname: 'AsanDesk Web',
          platform: 'WebDesktop',
          displays: [link.displayInfo],
          current_display: 0,
          version: PROTOCOL_VERSION,
          encoding: { vp8: link.codecKey === 'vp8s', h264: false, h265: false, av1: false },
        },
      },
    });
    for (const permission of [Permission.Keyboard, Permission.Clipboard, Permission.Audio, Permission.File, Permission.Restart]) {
      this.conn.send({ misc: { permission_info: { permission, enabled: false } } });
    }
    const req = this.request;
    if (req) {
      this.host.addViewer({ key: this.key, peerId: req.peerId, peerName: req.peerName, since: Date.now() });
      this.logged = true;
      this.logId = (await this.host.log(req.peerId, req.peerName, this.key)) ?? null;
    }
  }

  reject() {
    clearTimeout(this.approvalTimer);
    if (this.done || this.approved) return;
    this.loginError('Connection not allowed');
    setTimeout(() => this.finish(), 500);
  }

  stop() {
    this.conn.send({ misc: { close_reason: 'Closed manually by the peer' } });
    setTimeout(() => this.finish(), 200);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.approvalTimer);
    clearInterval(this.keepalive);
    this.link?.stop();
    this.conn.close();
    if (this.logged) this.host.logEnd(this.logId, this.key);
    this.host.removeIncoming(this);
  }
}

export class ShareHost {
  otp = randomString(6);
  private signSk: Uint8Array;
  private nextKey = 1;
  private incoming = new Map<number, Incoming>();
  private viewers: Viewer[] = [];
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement;
  onOtp: ((otp: string) => void) | null = null;
  /** صفحه‌ای انتخاب شده و هنوز در دست است (در حال نمایش یا نگه‌داشته برای اتصال بعدی) */
  onStream: ((live: boolean) => void) | null = null;

  private cfg: WebConfig;
  private identity: Identity;
  private cb: ShareCallbacks;

  constructor(cfg: WebConfig, identity: Identity, cb: ShareCallbacks) {
    this.cfg = cfg;
    this.identity = identity;
    this.cb = cb;
    this.signSk = signKeyPairFromSeed(b64decode(identity.seed)).secretKey;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  refreshOtp() {
    this.otp = randomString(6);
    this.onOtp?.(this.otp);
  }

  /** درگاه خبر داد کسی می‌خواهد وصل شود: به رله وصل و دست‌دادن را شروع کن */
  async handleIncoming(uuid: string, relayServer: string) {
    let conn: WsTransport;
    try {
      conn = await WsTransport.open(relayWsUrl(this.cfg, relayServer));
    } catch {
      return;
    }
    conn.sendRendezvous({ request_relay: { licence_key: this.cfg.key, uuid, conn_type: ConnType.DEFAULT_CONN } });
    const inc = new Incoming(this.nextKey++, this, conn);
    this.incoming.set(inc.key, inc);
    try {
      await inc.run({ webId: this.identity.webId, signSk: this.signSk });
    } catch {
      inc.finish();
    }
  }

  raiseRequest(req: IncomingRequest) {
    this.cb.onRequest(req);
  }

  /**
   * باید مستقیم در رویداد کلیک «اجازه» صدا زده شود: مرورگر انتخاب صفحه را فقط با کلیک کاربر باز می‌کند.
   */
  approve(key: number): Promise<void> {
    const inc = this.incoming.get(key);
    if (!inc) return Promise.resolve();
    const ready = this.hasStream()
      ? Promise.resolve(this.stream as MediaStream)
      : navigator.mediaDevices
          .getDisplayMedia(this.displayOptions())
          .then(async (s) => {
            this.stream = s;
            this.video.srcObject = s;
            await this.video.play().catch(() => undefined);
            const track = s.getVideoTracks()[0];
            track.addEventListener('ended', () => this.stopAll());
            const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
            if (surface) writeLocal(SURFACE_KEY, surface);
            this.onStream?.(true);
            return s;
          });
    this.cb.onRequestGone(key);
    return ready.then(
      (s) => inc.accept(s, this.video, this.identity.name),
      () => {
        // کاربر انتخاب صفحه را بست یا مرورگر اجازه نداد
        inc.reject();
        this.cb.onError?.('share_cancelled');
      },
    );
  }

  private hasStream(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  /** انتخاب‌گر مرورگر؛ با «به یاد داشته باش» روی همان نوعی (کل صفحه، پنجره، زبانه) که دفعهٔ قبل انتخاب شد باز می‌شود */
  private displayOptions(): DisplayMediaStreamOptions {
    const video: MediaTrackConstraints & { displaySurface?: string } = { frameRate: { ideal: FPS, max: 30 } };
    const surface = shareRemembered() ? readLocal(SURFACE_KEY) : '';
    if (surface === 'monitor' || surface === 'window' || surface === 'browser') video.displaySurface = surface;
    // زبانهٔ خود آسان دسک وب به کار نمی‌آید (فقط همین صفحه را نشان می‌داد)
    return { video, audio: false, selfBrowserSurface: 'exclude' } as DisplayMediaStreamOptions;
  }

  /** «تنظیمات من را به یاد داشته باش»؛ خاموش شدنش صفحهٔ نگه‌داشته را رها می‌کند */
  setRemember(on: boolean) {
    writeLocal(REMEMBER_KEY, on ? '1' : '0');
    if (!on && this.viewers.length === 0) this.releaseStream();
  }

  /** صفحهٔ نگه‌داشته را رها کن (اتصال بعدی دوباره انتخاب‌گر را باز می‌کند) */
  forgetStream() {
    if (this.viewers.length === 0) this.releaseStream();
  }

  reject(key: number) {
    this.incoming.get(key)?.reject();
    this.cb.onRequestGone(key);
  }

  stopViewer(key: number) {
    this.incoming.get(key)?.stop();
  }

  stopAll() {
    for (const inc of [...this.incoming.values()]) inc.stop();
    this.releaseStream();
  }

  addViewer(v: Viewer) {
    this.viewers = [...this.viewers, v];
    this.cb.onViewers(this.viewers);
  }

  removeIncoming(inc: Incoming) {
    this.incoming.delete(inc.key);
    this.cb.onRequestGone(inc.key);
    const had = this.viewers.some((v) => v.key === inc.key);
    this.viewers = this.viewers.filter((v) => v.key !== inc.key);
    this.cb.onViewers(this.viewers);
    if (had) this.refreshOtp(); // مثل برنامهٔ دسکتاپ: بعد از هر جلسه رمز یک‌بارمصرف تازه می‌شود
    if (this.viewers.length === 0 && !shareRemembered()) this.releaseStream();
  }

  private releaseStream() {
    if (!this.stream) return;
    for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.onStream?.(false);
  }

  /** شمارهٔ اتصال‌های بازی که صفحه را می‌بینند (برای heartbeat) */
  viewerKeys(): number[] {
    return this.viewers.map((v) => v.key);
  }

  async log(peerId: string, peerName: string, key: number): Promise<number | null> {
    return this.cb.onLog ? this.cb.onLog('in', peerId, peerName, key) : null;
  }

  logEnd(id: number | null, key: number) {
    this.cb.onLogEnd?.(id, key);
  }

  reportError(key: string) {
    this.cb.onError?.(key);
  }

  dispose() {
    this.stopAll();
  }
}
