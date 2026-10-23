// اتصال به درگاه وب (webgw): تا این اتصال باز است، کد این حساب در سرور شناسه «آنلاین» است و اگر کسی
// آن را وارد کند، درگاه uuid رله را این‌جا می‌فرستد. پیام‌ها JSON متنی‌اند.
import { toWsUrl } from './transport';

export type GatewayState = 'connecting' | 'online' | 'offline' | 'blocked' | 'conflict' | 'replaced' | 'busy';

export interface GatewayEvents {
  onState(state: GatewayState): void;
  onIncoming(uuid: string, relayServer: string): void;
  /** درگاه ورود را نپذیرفت (خروج، مسدودی یا رمز تازه از پنل) */
  onUnauthorized?(): void;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer = 0;
  private pinger = 0;
  private stopped = false;
  state: GatewayState = 'connecting';

  private url: string;
  private ev: GatewayEvents;

  constructor(url: string, ev: GatewayEvents) {
    this.url = url;
    this.ev = ev;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  /** «استفاده در این زبانه» بعد از این‌که زبانهٔ دیگری کد را گرفته بود */
  takeOver() {
    this.retry = 0;
    this.ws?.close();
    this.connect();
  }

  private set(state: GatewayState) {
    if (this.state === state) return;
    this.state = state;
    this.ev.onState(state);
  }

  private connect() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.set('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(toWsUrl(this.url));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      clearInterval(this.pinger);
      this.pinger = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 20_000);
    };
    ws.onmessage = (ev) => {
      let msg: { t?: string; state?: GatewayState; uuid?: string; relay_server?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'state' && msg.state) this.set(msg.state);
      else if (msg.t === 'incoming' && msg.uuid) this.ev.onIncoming(msg.uuid, msg.relay_server || '');
    };
    ws.onclose = (ev) => {
      clearInterval(this.pinger);
      if (this.ws !== ws) return;
      this.ws = null;
      // 4401: ورود باطل شده؛ 4403: حساب مسدود؛ 4409: زبانهٔ دیگری کد را گرفت
      if (ev.code === 4403) this.set('blocked');
      else if (ev.code === 4409) this.set('replaced');
      else if (ev.code === 4401) {
        this.set('offline');
        this.ev.onUnauthorized?.();
      }
      else {
        this.set('offline');
        this.scheduleRetry();
      }
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry);
    this.retry += 1;
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
