// گزارش به داشبورد مثل برنامهٔ دسکتاپ، با همان API کلاینت‌ها (backend/clients/client_api.py):
// heartbeat هر ۱۵ ثانیه، sysinfo وقتی سرور بخواهد، علت اتصال‌های ناموفق، اتصال‌های ورودی (audit) و بازخورد.
// شناسهٔ این «دستگاه» کد کاربر وب و uuid آن uuid حساب است؛ پس کاربر وب در فهرست کلاینت‌های پنل با پلتفرم
// «Web» دیده می‌شود و دکمهٔ «مسدودسازی» آن‌جا روی او هم کار می‌کند.
import { b64encode } from './net/crypto';
import { alog, logText } from './log';
import { WEB_VERSION } from './version';

export interface DeviceIdentity {
  id: string;
  uuid: string;
  name: string;
  username: string;
}

const HEARTBEAT_MS = 15_000;
const FAILURE_GAP_MS = 30_000;

async function post(path: string, body: object): Promise<Response | null> {
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
  } catch {
    return null;
  }
}

/** «AsanDesk Web · Chrome 130 · Windows» — پنل از پیشوند AsanDesk Web پلتفرم Web را تشخیص می‌دهد */
export function browserInfo(): { browser: string; os: string } {
  const ua = navigator.userAgent;
  const pick = (re: RegExp) => ua.match(re)?.[1];
  const browser =
    (pick(/Edg\/(\d+)/) && `Edge ${pick(/Edg\/(\d+)/)}`) ||
    (pick(/OPR\/(\d+)/) && `Opera ${pick(/OPR\/(\d+)/)}`) ||
    (pick(/Firefox\/(\d+)/) && `Firefox ${pick(/Firefox\/(\d+)/)}`) ||
    (pick(/Chrome\/(\d+)/) && `Chrome ${pick(/Chrome\/(\d+)/)}`) ||
    (pick(/Version\/(\d+).*Safari/) && `Safari ${pick(/Version\/(\d+).*Safari/)}`) ||
    'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : '';
  return { browser, os };
}

export function osText(): string {
  const { browser, os } = browserInfo();
  return ['AsanDesk Web', browser, os].filter(Boolean).join(' · ');
}

export class Telemetry {
  private timer = 0;
  private lastFailure = new Map<string, number>();
  private dev: DeviceIdentity;
  private onBlocked: (blocked: boolean) => void;
  /** شناسهٔ اتصال‌های ورودی باز (اشتراک صفحه) */
  conns: () => number[] = () => [];

  constructor(dev: DeviceIdentity, onBlocked: (blocked: boolean) => void) {
    this.dev = dev;
    this.onBlocked = onBlocked;
  }

  private body(extra: object = {}) {
    return { id: this.dev.id, uuid: this.dev.uuid, ...extra };
  }

  start() {
    void this.heartbeat();
    this.timer = window.setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async heartbeat() {
    const res = await post('/api/heartbeat', this.body({ conns: this.conns() }));
    if (!res || !res.ok) return;
    let rsp: { blocked?: boolean; sysinfo?: boolean } = {};
    try {
      rsp = await res.json();
    } catch {
      return;
    }
    if (rsp.sysinfo) await this.sysinfo();
    if (typeof rsp.blocked === 'boolean') this.onBlocked(rsp.blocked);
  }

  async sysinfo() {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const res = await post('/api/sysinfo', this.body({
      hostname: this.dev.name,
      username: this.dev.username,
      os: osText(),
      cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : '',
      memory: nav.deviceMemory ? `${nav.deviceMemory}GB` : '',
      version: WEB_VERSION,
      loc: true,
    }));
    alog('sysinfo', res?.status ?? 'network error');
  }

  /** اتصال به دستگاه دیگری نشد؛ مثل برنامهٔ دسکتاپ حداکثر یک بار در ۳۰ ثانیه برای هر مقصد و علت */
  connFailure(peer: string, reason: string, detail = '') {
    const key = `${peer}|${reason}`;
    const now = Date.now();
    if (now - (this.lastFailure.get(key) ?? 0) < FAILURE_GAP_MS) return;
    this.lastFailure.set(key, now);
    void post('/api/client/conn-failure', this.body({ peer, reason, detail: detail.slice(0, 200), type: 'remote', version: WEB_VERSION }));
  }

  /** اتصال ورودی (کسی صفحهٔ این کاربر را می‌بیند) برای آمار پنل */
  connOpened(connId: number, peerId: string, peerName: string) {
    void post('/api/audit/conn', this.body({ conn_id: connId, action: 'new' })).then(() =>
      post('/api/audit/conn', this.body({ conn_id: connId, peer: [peerId, peerName], type: 0 })),
    );
  }

  connClosed(connId: number) {
    void post('/api/audit/conn', this.body({ conn_id: connId, action: 'close' }));
  }

  /** «ارسال بازخورد»؛ پاسخ: کد پیگیری یا کلید پیام خطا */
  async feedback(data: {
    category: string;
    message: string;
    contact: string;
    attachLog: boolean;
    images: { name: string; mime: string; data: string }[];
    lang: string;
    theme: string;
  }): Promise<{ code?: string; error?: string }> {
    const { browser, os } = browserInfo();
    const body: Record<string, unknown> = this.body({
      category: data.category,
      message: data.message,
      contact: data.contact,
      version: WEB_VERSION,
      os: 'Web',
      os_version: `${browser} · ${os}`,
      screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
      lang: data.lang,
      theme: data.theme,
      log_attached: data.attachLog,
      images: data.images,
    });
    if (data.attachLog) {
      body.log = await gzipBase64(logText());
      body.log_files = ['web.log'];
    }
    const res = await post('/api/client/feedback', body);
    if (!res) return { error: 'asan_feedback_network' };
    if (res.status === 413) return { error: 'asan_feedback_too_big' };
    if (res.status === 429) return { error: 'asan_feedback_wait' };
    if (res.status === 404 || res.status === 405) return { error: 'asan_feedback_failed' };
    try {
      const json = await res.json();
      if (res.ok) return { code: String(json.code || json.id || '') };
      return { error: typeof json.error === 'string' ? json.error : 'asan_feedback_failed' };
    } catch {
      return { error: 'asan_feedback_failed' };
    }
  }
}

async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return b64encode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** تصویر پیوست: حداکثر ۱۶۰۰ پیکسل و JPEG، مثل برنامهٔ دسکتاپ (EXIF هم حذف می‌شود) */
export async function prepareImage(file: File): Promise<{ name: string; mime: string; data: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob) return null;
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: b64encode(new Uint8Array(await blob.arrayBuffer())) };
  } catch {
    return null;
  }
}
