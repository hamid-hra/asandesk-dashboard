// ثبت کد یک کاربر وب در سرور شناسه، همان کاری که rendezvous_mediator.rs برنامهٔ دسکتاپ می‌کند:
//
// * هر ۱۲ ثانیه RegisterPeer روی UDP (hbbs بعد از ۳۰ ثانیه بی‌خبری دستگاه را آفلاین می‌داند).
// * اگر hbbs کلید بخواهد (request_pk)، RegisterPk با uuid و کلید عمومی Ed25519 حساب.
// * PunchHole / FetchLocalAddr / RequestRelay یعنی کسی این کد را وارد کرده: یک uuid رله می‌سازیم،
//   RelayResponse را روی TCP به hbbs می‌فرستیم (hbbs آن را با کلید امضاشده به کنترل‌کننده می‌رساند) و به
//   مرورگر می‌گوییم با همان uuid به رله وصل شود.
//
// هر کد سوکت UDP خودش را دارد: PunchHole نمی‌گوید برای کدام شناسه است، فقط به نشانی ثبت‌شده می‌رسد.
import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import { RegisterPkResult, decode, encode, frame, type Msg } from './proto.ts';

export const REG_INTERVAL_MS = 12_000;
const OFFLINE_AFTER_MS = 30_000;
const PK_RETRY_MS = 10_000;
const TOO_FREQUENT_RETRY_MS = 65_000;
const INCOMING_PER_MINUTE = 8;
const PROTOCOL_VERSION = '1.5.0';

export type RegState = 'connecting' | 'online' | 'offline' | 'conflict';

export interface GwConfig {
  hbbsHost: string;
  hbbsPort: number;
  /** رله‌ای که به کنترل‌کننده‌ها معرفی می‌شود؛ باید همان رله‌ای باشد که /ws/relay به آن می‌رسد */
  relayServer: string;
  log: (line: string) => void;
}

export interface PeerIdentity {
  webId: string;
  uuid: string;
  pk: string;
}

export interface RegistrationHooks {
  onState(state: RegState): void;
  onIncoming(uuid: string, relayServer: string): void;
}

export class Registration {
  state: RegState = 'connecting';
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastAnswer = 0;
  private lastPkAt = 0;
  private pkBlockedUntil = 0;
  private incomingTimes: number[] = [];
  private lastPunch = { key: '', at: 0 };
  private stopped = false;

  private cfg: GwConfig;
  private peer: PeerIdentity;
  private hooks: RegistrationHooks;

  constructor(cfg: GwConfig, peer: PeerIdentity, hooks: RegistrationHooks) {
    this.cfg = cfg;
    this.peer = peer;
    this.hooks = hooks;
  }

  start() {
    const socket = dgram.createSocket('udp4');
    this.socket = socket;
    socket.on('message', (data) => {
      try {
        this.onMessage(decode(data));
      } catch {
        /* datagram we cannot read */
      }
    });
    socket.on('error', (err) => this.cfg.log(`udp error for ${this.peer.webId}: ${err.message}`));
    socket.bind(0, () => {
      this.tick();
      this.timer = setInterval(() => this.tick(), REG_INTERVAL_MS);
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
  }

  private setState(state: RegState) {
    if (this.state === state) return;
    this.state = state;
    this.hooks.onState(state);
  }

  private send(msg: Msg) {
    if (!this.socket || this.stopped) return;
    const bytes = encode(msg);
    this.socket.send(bytes, this.cfg.hbbsPort, this.cfg.hbbsHost, (err) => {
      if (err) this.cfg.log(`udp send failed for ${this.peer.webId}: ${err.message}`);
    });
  }

  private tick() {
    if (this.state === 'conflict') return;
    if (this.state === 'online' && Date.now() - this.lastAnswer > OFFLINE_AFTER_MS) this.setState('offline');
    this.send({ register_peer: { id: this.peer.webId, serial: 0 } });
  }

  private sendPk() {
    const now = Date.now();
    if (now < this.pkBlockedUntil || now - this.lastPkAt < PK_RETRY_MS) return;
    this.lastPkAt = now;
    this.send({
      register_pk: {
        id: this.peer.webId,
        uuid: Buffer.from(this.peer.uuid, 'base64'),
        pk: Buffer.from(this.peer.pk, 'base64'),
      },
    });
  }

  private onMessage(m: Msg) {
    switch (m.union) {
      case 'register_peer_response':
        this.lastAnswer = Date.now();
        if (m.register_peer_response.request_pk) {
          this.sendPk();
          if (this.state === 'online') this.setState('connecting');
        } else {
          this.setState('online');
        }
        break;
      case 'register_pk_response': {
        this.lastAnswer = Date.now();
        const result = m.register_pk_response.result ?? RegisterPkResult.OK;
        if (result === RegisterPkResult.OK) {
          this.setState('online');
        } else if (result === RegisterPkResult.UUID_MISMATCH || result === RegisterPkResult.INVALID_ID_FORMAT) {
          // این کد در hbbs مال دستگاه دیگری است؛ بی‌صدا تلاش‌کردن فایده ندارد
          this.cfg.log(`code ${this.peer.webId} is taken on hbbs (result ${result})`);
          this.setState('conflict');
        } else if (result === RegisterPkResult.TOO_FREQUENT) {
          this.pkBlockedUntil = Date.now() + TOO_FREQUENT_RETRY_MS;
          this.cfg.log(`hbbs says too frequent for ${this.peer.webId}; retrying later`);
        }
        break;
      }
      case 'punch_hole': {
        const ph = m.punch_hole;
        this.incoming(ph.socket_addr, true);
        break;
      }
      case 'fetch_local_addr': {
        const fla = m.fetch_local_addr;
        this.incoming(fla.socket_addr, true);
        break;
      }
      case 'request_relay': {
        const rr = m.request_relay;
        if (rr.uuid) this.incoming(rr.socket_addr, false, rr.uuid, rr.relay_server);
        break;
      }
      default:
        break;
    }
  }

  private incoming(socketAddr: Uint8Array, initiate: boolean, givenUuid?: string, givenRelay?: string) {
    if (!socketAddr || socketAddr.length === 0) return;
    const now = Date.now();
    // hbbs گاهی یک درخواست را دوبار می‌فرستد (مثل LAST_MSG در برنامهٔ دسکتاپ)
    const key = Buffer.from(socketAddr).toString('hex');
    if (this.lastPunch.key === key && now - this.lastPunch.at < 1000) return;
    this.lastPunch = { key, at: now };
    this.incomingTimes = this.incomingTimes.filter((t) => now - t < 60_000);
    if (this.incomingTimes.length >= INCOMING_PER_MINUTE) {
      this.cfg.log(`too many incoming requests for ${this.peer.webId}; ignored`);
      return;
    }
    this.incomingTimes.push(now);
    const uuid = givenUuid || randomUUID();
    const relay = givenRelay || this.cfg.relayServer;
    const rr: Msg = { socket_addr: socketAddr, version: PROTOCOL_VERSION };
    if (initiate) {
      rr.uuid = uuid;
      rr.relay_server = relay;
      rr.id = this.peer.webId;
    }
    sendRelayResponse(this.cfg, encode({ relay_response: rr }));
    this.hooks.onIncoming(uuid, relay);
  }
}

/** RelayResponse روی یک اتصال TCP کوتاه به hbbs (مثل create_relay در rendezvous_mediator.rs) */
export function sendRelayResponse(cfg: GwConfig, bytes: Uint8Array) {
  const sock = net.connect({ host: cfg.hbbsHost, port: cfg.hbbsPort });
  sock.setTimeout(10_000);
  sock.on('connect', () => {
    sock.write(frame(bytes));
    // hbbs پیام را پردازش کند، بعد اتصال بسته می‌شود
    setTimeout(() => sock.end(), 1500);
  });
  sock.on('timeout', () => sock.destroy());
  sock.on('error', (err) => cfg.log(`relay response to hbbs failed: ${err.message}`));
}
