// اتصال وب‌سوکت به سرور شناسه/رله: هر پیام وب‌سوکت یک پیام protobuf است (hbbs و hbbr طرف TCP را خودشان
// قاب‌بندی می‌کنند). بعد از دست‌دادن، همهٔ پیام‌ها با StreamCipher رمز می‌شوند.
import { StreamCipher } from './crypto';
import { decodeMessage, encodeMessage, encodeRendezvous, type Msg } from './proto';

export class ConnectionClosed extends Error {
  constructor(reason = 'closed') {
    super(reason);
  }
}

type Waiter = { resolve: (b: Uint8Array) => void; reject: (e: Error) => void };

export class WsTransport {
  private queue: Uint8Array[] = [];
  private waiters: Waiter[] = [];
  private closedReason: string | null = null;
  private cipher: StreamCipher | null = null;
  /** وقتی تنظیم شود، پیام‌ها به‌جای صف مستقیم به این تابع می‌روند (حلقهٔ اصلی جلسه) */
  private handler: ((msg: Msg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  lastRecv = Date.now();

  private ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      this.lastRecv = Date.now();
      let bytes: Uint8Array = new Uint8Array(ev.data);
      try {
        if (this.cipher) bytes = this.cipher.decrypt(bytes);
      } catch {
        this.close('decryption error');
        return;
      }
      if (this.handler) {
        let msg: Msg;
        try {
          msg = decodeMessage(bytes);
        } catch {
          return;
        }
        this.handler(msg);
        return;
      }
      const w = this.waiters.shift();
      if (w) w.resolve(bytes);
      else this.queue.push(bytes);
    };
    ws.onclose = (ev) => this.finish(ev.reason || 'closed');
    ws.onerror = () => this.finish('connection error');
  }

  static open(url: string, timeoutMs = 15000): Promise<WsTransport> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(toWsUrl(url));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new WsTransport(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('connection error'));
      };
    });
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  setCipher(cipher: StreamCipher) {
    this.cipher = cipher;
  }

  get secured(): boolean {
    return this.cipher !== null;
  }

  sendRaw(bytes: Uint8Array) {
    if (this.closed) return;
    const out = this.cipher ? this.cipher.encrypt(bytes) : bytes;
    this.ws.send(out);
  }

  send(msg: Msg) {
    this.sendRaw(encodeMessage(msg));
  }

  sendRendezvous(msg: Msg) {
    this.sendRaw(encodeRendezvous(msg));
  }

  next(timeoutMs = 15000): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closedReason !== null) return Promise.reject(new ConnectionClosed(this.closedReason));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (b) => {
          clearTimeout(timer);
          resolve(b);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async nextMessage(timeoutMs = 15000): Promise<Msg> {
    return decodeMessage(await this.next(timeoutMs));
  }

  /** از این به بعد پیام‌ها رمزگشایی و به `handler` داده می‌شوند (پیام‌های صف‌شده هم) */
  listen(handler: (msg: Msg) => void) {
    this.handler = handler;
    for (const bytes of this.queue.splice(0)) {
      try {
        handler(decodeMessage(bytes));
      } catch {
        /* پیام ناخوانا نادیده گرفته می‌شود */
      }
    }
  }

  close(reason = 'closed') {
    if (this.closedReason === null) {
      try {
        this.ws.close(1000);
      } catch {
        /* already closed */
      }
    }
    this.finish(reason);
  }

  private finish(reason: string) {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    for (const w of this.waiters.splice(0)) w.reject(new ConnectionClosed(reason));
    this.onClose?.(reason);
  }
}

/** مسیر نسبی (مثل /ws/id) → wss://همین-دامنه/ws/id */
export function toWsUrl(url: string): string {
  if (/^wss?:\/\//.test(url)) return url;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${url.startsWith('/') ? '' : '/'}${url}`;
}
