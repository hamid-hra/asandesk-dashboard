// آزمون سرتاسری پروتکل: کنترل‌کنندهٔ وب ← hbbs/hbbr ساختگی ← درگاه واقعی (webgw) ← اشتراک‌گذار وب
//
// hbbs و hbbr ساختگی همان رفتاری را دارند که در کد rustdesk-server دیده می‌شود:
// PunchHoleRequest روی وب‌سوکت → PunchHole روی UDP به نشانی ثبت‌شده؛ RelayResponse روی TCP → امضای
// IdPk با کلید سرور و فرستادن به درخواست‌کننده؛ رله دو اتصال با uuid یکسان را به هم وصل می‌کند.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import nacl from 'tweetnacl';
import { WebSocket as WsClient, WebSocketServer } from 'ws';

// ---- محیط مرورگر برای کدهای net/ ----
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
class FakeVideoFrame {
  displayWidth: number;
  displayHeight: number;
  timestamp: number;
  constructor(src: { videoWidth: number; videoHeight: number }, init: { timestamp: number }) {
    this.displayWidth = src.videoWidth;
    this.displayHeight = src.videoHeight;
    this.timestamp = init.timestamp;
  }
  close() {}
}
class FakeEncoder {
  static isConfigSupported = async () => ({ supported: true });
  state = 'unconfigured';
  encodeQueueSize = 0;
  private output: (chunk: unknown) => void;
  constructor(init: { output: (chunk: unknown) => void }) {
    this.output = init.output;
  }
  configure() {
    this.state = 'configured';
  }
  encode(frame: FakeVideoFrame, opts?: { keyFrame?: boolean }) {
    this.output({
      type: opts?.keyFrame ? 'key' : 'delta',
      byteLength: 4,
      timestamp: frame.timestamp,
      copyTo: (d: Uint8Array) => d.set([1, 2, 3, 4]),
    });
  }
  close() {
    this.state = 'closed';
  }
}
g.VideoFrame = FakeVideoFrame;
g.VideoEncoder = FakeEncoder;
const fakeVideo = { muted: false, playsInline: false, srcObject: null, readyState: 4, videoWidth: 1280, videoHeight: 720, play: async () => {} };
g.document = { createElement: (tag: string) => (tag === 'video' ? fakeVideo : { getContext: () => null, width: 0, height: 0 }) };
const track = { readyState: 'live', getSettings: () => ({ width: 1280, height: 720 }), addEventListener() {}, stop() {}, clone() { return track; } };
const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getDisplayMedia: async () => stream } },
  configurable: true,
});

const { encodeIdPk, decodeRendezvous, encodeRendezvous } = await import('../src/net/proto.ts');
const { b64encode, signKeyPairFromSeed, randomBytes } = await import('../src/net/crypto.ts');
const { RemoteSession } = await import('../src/net/session.ts');
const { ShareHost } = await import('../src/net/share.ts');
const { startServer } = await import('../../webgw/src/main.ts');

type SessionState = import('../src/net/session.ts').SessionState;

const server = nacl.sign.keyPair();
const seed = randomBytes(32);
const PEER = { web_id: '3555000111', uuid: b64encode(randomBytes(16)), pk: b64encode(signKeyPairFromSeed(seed).publicKey) };

let hbbsPort = 0;
let idWsPort = 0;
let relayPort = 0;
const closers: (() => void)[] = [];
let relayedFromSharer = 0;
let sharerUuid = '';

function waitFor<T>(fn: () => T | undefined | null | false, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) {
        clearInterval(iv);
        resolve(v as T);
      } else if (Date.now() - start > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

before(async () => {
  // --- hbbs ساختگی ---
  const peers = new Map<string, { addr: { port: number; address: string }; pk?: Uint8Array }>();
  const requesters = new Map<string, import('ws').WebSocket>();
  let nextAddr = 1;
  const tcp = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length) {
        const headLen = (buf[0] & 3) + 1;
        if (buf.length < headLen) break;
        let n = 0;
        for (let i = headLen - 1; i >= 0; i--) n = n * 256 + buf[i];
        n = Math.floor(n / 4);
        if (buf.length < headLen + n) break;
        const msg = decodeRendezvous(buf.subarray(headLen, headLen + n));
        buf = buf.subarray(headLen + n);
        const rr = msg.relay_response;
        if (!rr) continue;
        const key = Buffer.from(rr.socket_addr).toString('hex');
        const ws = requesters.get(key);
        const peer = peers.get(rr.id);
        if (!ws || !peer?.pk) continue;
        const signed = nacl.sign(encodeIdPk({ id: rr.id, pk: peer.pk }), server.secretKey);
        ws.send(encodeRendezvous({ relay_response: { uuid: rr.uuid, relay_server: rr.relay_server, pk: signed, version: rr.version } }));
      }
    });
  });
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', () => r()));
  hbbsPort = (tcp.address() as AddressInfo).port;
  const udp = dgram.createSocket('udp4');
  udp.on('message', (data, rinfo) => {
    const msg = decodeRendezvous(data);
    if (msg.register_peer) {
      const p = peers.get(msg.register_peer.id);
      if (p) p.addr = { port: rinfo.port, address: rinfo.address };
      else peers.set(msg.register_peer.id, { addr: { port: rinfo.port, address: rinfo.address } });
      udp.send(encodeRendezvous({ register_peer_response: { request_pk: !peers.get(msg.register_peer.id)?.pk } }), rinfo.port, rinfo.address);
    } else if (msg.register_pk) {
      const p = peers.get(msg.register_pk.id)!;
      p.pk = Uint8Array.from(msg.register_pk.pk);
      p.addr = { port: rinfo.port, address: rinfo.address };
      udp.send(encodeRendezvous({ register_pk_response: { result: 0 } }), rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((r) => udp.bind(hbbsPort, '127.0.0.1', () => r()));
  const idWs = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  idWs.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = decodeRendezvous(new Uint8Array(data as Buffer));
      const ph = msg.punch_hole_request;
      if (!ph) return;
      assert.equal(ph.licence_key, b64encode(server.publicKey));
      const peer = peers.get(ph.id);
      if (!peer?.pk) {
        ws.send(encodeRendezvous({ punch_hole_response: { failure: 0 } }));
        return;
      }
      const addr = Uint8Array.from([0, 0, 0, 0, 0, nextAddr++]);
      requesters.set(Buffer.from(addr).toString('hex'), ws);
      udp.send(encodeRendezvous({ punch_hole: { socket_addr: addr, relay_server: 'from-hbbs', nat_type: ph.nat_type } }), peer.addr.port, peer.addr.address);
    });
  });
  await new Promise<void>((r) => idWs.on('listening', () => r()));
  idWsPort = (idWs.address() as AddressInfo).port;

  // --- hbbr ساختگی ---
  // hbbr تا جفت شدن از اتصال اول چیزی نمی‌خواند، پس پیام‌هایی که زودتر فرستاده می‌شوند می‌مانند
  type Side = { ws: import('ws').WebSocket; queue: Buffer[]; peer: Side | null; sharer: boolean };
  const waiting = new Map<string, Side>();
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  relay.on('connection', (ws) => {
    const me: Side = { ws, queue: [], peer: null, sharer: false };
    let first = true;
    ws.on('message', (data) => {
      const d = data as Buffer;
      if (first) {
        first = false;
        const uuid = decodeRendezvous(new Uint8Array(d)).request_relay?.uuid;
        if (!uuid) return ws.close();
        const other = waiting.get(uuid);
        if (!other) {
          // اشتراک‌گذار همان کسی است که uuid را از درگاه گرفته و اول می‌رسد
          me.sharer = uuid === sharerUuid;
          waiting.set(uuid, me);
          return;
        }
        waiting.delete(uuid);
        me.sharer = !other.sharer;
        me.peer = other;
        other.peer = me;
        for (const q of other.queue.splice(0)) send(other, q);
        other.ws.on('close', () => ws.close());
        ws.on('close', () => other.ws.close());
        return;
      }
      if (me.peer) send(me, d);
      else me.queue.push(d);
    });
  });
  const send = (from: Side, d: Buffer) => {
    if (from.sharer) relayedFromSharer += 1;
    const to = from.peer!.ws;
    if (to.readyState === to.OPEN && d.length) to.send(d);
  };
  await new Promise<void>((r) => relay.on('listening', () => r()));
  relayPort = (relay.address() as AddressInfo).port;

  // --- backend ساختگی برای درگاه ---
  const backend = http.createServer((req, res) => {
    const ok = req.url === '/api/web/me/peer' && req.headers.cookie === 'asw_session=ok';
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(ok ? JSON.stringify(PEER) : '{}');
  });
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));
  const gw = startServer({
    port: 0,
    backendUrl: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`,
    hbbsHost: '127.0.0.1',
    hbbsPort,
    relayServer: 'relay.test',
    revalidateMs: 60_000,
    maxOnline: 10,
    maxPerIp: 10,
    graceMs: 100,
    log: () => undefined,
  });
  await new Promise<void>((r) => gw.server.on('listening', () => r()));
  g.__gwPort = (gw.server.address() as AddressInfo).port;
  closers.push(() => gw.close(), () => backend.close(), () => relay.close(), () => idWs.close(), () => udp.close(), () => tcp.close());
});

after(() => {
  for (const c of closers) c();
});

const cfg = () => ({
  key: b64encode(server.publicKey),
  id_ws: `ws://127.0.0.1:${idWsPort}`,
  relay_ws: `ws://127.0.0.1:${relayPort}`,
  relay_ws_map: {},
  gw_ws: '/ws/gw',
  rendezvous_host: 'test',
  download_url: '',
});

test('a web user sees another web user\'s screen through the gateway, the relay and the one-time password', async () => {
  const requests: number[] = [];
  let viewerCount = 0;
  const host = new ShareHost(cfg(), { webId: PEER.web_id, seed: b64encode(seed), name: 'Sharer' }, {
    onRequest: (req) => {
      requests.push(req.key);
      assert.equal(req.peerId, '3999999999');
      assert.equal(req.peerName, 'Viewer');
      void host.approve(req.key);
    },
    onRequestGone: () => undefined,
    onViewers: (v) => {
      viewerCount = v.length;
    },
  });
  const firstOtp = host.otp;

  // مرورگر اشتراک‌گذار به درگاه وصل است (به‌جای GatewayClient، چون Node کوکی را با WebSocket مرورگر نمی‌فرستد)
  const gwSocket = new WsClient(`ws://127.0.0.1:${g.__gwPort}/ws/gw`, { headers: { cookie: 'asw_session=ok' } });
  const states: string[] = [];
  gwSocket.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (process.env.E2E_DEBUG) console.log('gw', m);
    if (m.t === 'state') states.push(m.state);
    if (m.t === 'incoming') {
      sharerUuid = m.uuid;
      assert.equal(m.relay_server, 'relay.test');
      void host.handleIncoming(m.uuid, m.relay_server);
    }
  });
  await waitFor(() => states.includes('online'));

  const canvas = { getContext: () => null, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  const session = new RemoteSession(cfg(), PEER.web_id, { webId: '3999999999', name: 'Viewer' }, canvas);
  let state: SessionState = session.state;
  session.subscribe((s) => {
    state = s;
    if (process.env.E2E_DEBUG) console.log('controller', s.phase, s.message, s.detail);
  });
  void session.start();

  // بدون رمز، اشتراک‌گذار کاری نمی‌کند و کنترل‌کننده رمز می‌خواهد
  await waitFor(() => state.phase === 'password');
  assert.equal(requests.length, 0);
  await session.submitPassword('wrong-pass', false);
  await waitFor(() => state.phase === 'password' && state.passwordError);
  assert.equal(requests.length, 0);

  await session.submitPassword(host.otp, false);
  await waitFor(() => state.phase === 'connected');
  assert.equal(requests.length, 1);
  assert.equal(state.peer?.hostname, 'AsanDesk Web');
  assert.deepEqual(state.peer?.displays.map((d) => [d.width, d.height]), [[1280, 720]]);
  assert.equal(state.keyboard, false, 'the browser never offers keyboard and mouse');
  await waitFor(() => viewerCount === 1);
  // فریم‌های تصویر از رله می‌گذرند
  const before = relayedFromSharer;
  await waitFor(() => relayedFromSharer > before + 5);

  session.close();
  await waitFor(() => viewerCount === 0);
  assert.notEqual(host.otp, firstOtp, 'the one-time password changes after the session');
  host.dispose();
  gwSocket.close();
});

test('an unknown code is reported as not existing', async () => {
  const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
  const session = new RemoteSession(cfg(), '123456789', { webId: '3999999999', name: 'Viewer' }, canvas);
  let state: SessionState = session.state;
  session.subscribe((s) => {
    state = s;
  });
  await session.start();
  await waitFor(() => state.phase === 'closed');
  assert.equal(state.message, 'err_not_exist');
});
