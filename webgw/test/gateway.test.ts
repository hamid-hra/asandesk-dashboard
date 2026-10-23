// درگاه در برابر یک hbbs ساختگی (UDP و TCP) و یک backend ساختگی
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { startServer, type Gateway } from '../src/main.ts';
import { decode, encode, unframe, type Msg } from '../src/proto.ts';

const PEER = { web_id: '3123456789', uuid: Buffer.from('0123456789abcdef').toString('base64'), pk: Buffer.alloc(32, 7).toString('base64') };

let udp: dgram.Socket;
let tcp: net.Server;
let backend: http.Server;
let gw: Gateway;
let forward: net.Server;
let gwPort = 0;
const udpInbox: { msg: Msg; port: number; address: string }[] = [];
const tcpInbox: Msg[] = [];
let validCookie = 'asw_session=good';

function waitFor<T>(fn: () => T | undefined, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v !== undefined) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - start > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

before(async () => {
  udp = dgram.createSocket('udp4');
  udp.on('message', (data, rinfo) => {
    const msg = decode(data);
    udpInbox.push({ msg, port: rinfo.port, address: rinfo.address });
    const reply = (m: Msg) => udp.send(encode(m), rinfo.port, rinfo.address);
    if (msg.register_peer) reply({ register_peer_response: { request_pk: !udpInbox.some((x) => x.msg.register_pk) } });
    if (msg.register_pk) reply({ register_pk_response: { result: 0 } });
  });
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()));

  tcp = net.createServer((sock) => {
    let buf: Uint8Array = new Uint8Array();
    sock.on('data', (chunk) => {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      const { messages, rest } = unframe(merged);
      buf = rest;
      for (const m of messages) tcpInbox.push(decode(m));
    });
  });
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', () => r()));

  backend = http.createServer((req, res) => {
    if (req.url === '/api/web/me/peer' && req.headers.cookie === validCookie) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(PEER));
    } else {
      res.writeHead(401);
      res.end('{}');
    }
  });
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));

  const hbbsPort = (udp.address() as AddressInfo).port;
  // TCP و UDP در hbbs واقعی یک درگاه دارند؛ این‌جا TCP ساختگی درگاه دیگری است، پس به همان UDP اشاره می‌کنیم
  // و برای TCP درگاه جدا را با یک پراکسی کوچک می‌گیریم
  const tcpPort = (tcp.address() as AddressInfo).port;
  forward = net.createServer((s) => {
    const c = net.connect(tcpPort, '127.0.0.1');
    s.pipe(c).pipe(s);
  });
  await new Promise<void>((r) => forward.listen(hbbsPort, '127.0.0.1', () => r()));

  gw = startServer({
    port: 0,
    backendUrl: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`,
    hbbsHost: '127.0.0.1',
    hbbsPort,
    relayServer: 'relay.example',
    revalidateMs: 200,
    maxOnline: 10,
    maxPerIp: 10,
    graceMs: 100,
    log: (l) => process.env.GW_DEBUG && console.log(l),
  });
  await new Promise<void>((r) => gw.server.on('listening', () => r()));
  gwPort = (gw.server.address() as AddressInfo).port;
});

after(() => {
  gw?.close();
  forward?.close();
  udp?.close();
  tcp?.close();
  backend?.close();
});

function connect(cookie: string): Promise<{ ws: WebSocket; inbox: Msg[]; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gwPort}/ws/gw`, { headers: { cookie } });
    const inbox: Msg[] = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (d) => inbox.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, inbox, closed }));
    ws.on('error', reject);
  });
}

test('a signed-out browser is turned away', async () => {
  const { closed } = await connect('asw_session=bad');
  assert.equal(await closed, 4401);
});

test('registers the code, answers a connection request and tells the browser', async () => {
  const { ws, inbox } = await connect(validCookie);
  const pk = await waitFor(() => udpInbox.find((x) => x.msg.register_pk)?.msg.register_pk);
  assert.equal(pk.id, PEER.web_id);
  assert.equal(Buffer.from(pk.uuid).toString('base64'), PEER.uuid);
  assert.equal(Buffer.from(pk.pk).toString('base64'), PEER.pk);
  await waitFor(() => inbox.find((m) => m.t === 'state' && m.state === 'online'));

  // کسی کد را وارد کرد: hbbs به نشانی ثبت‌شده PunchHole می‌فرستد
  const reg = udpInbox.find((x) => x.msg.register_peer)!;
  const requester = Uint8Array.from([9, 8, 7, 6, 5, 4]);
  udp.send(encode({ punch_hole: { socket_addr: requester, relay_server: 'ignored', nat_type: 2 } }), reg.port, reg.address);

  const incoming = await waitFor(() => inbox.find((m) => m.t === 'incoming'));
  const rr = (await waitFor(() => tcpInbox.find((m) => m.relay_response)))!.relay_response;
  assert.equal(incoming.relay_server, 'relay.example');
  assert.equal(rr.uuid, incoming.uuid);
  assert.equal(rr.relay_server, 'relay.example');
  assert.equal(rr.id, PEER.web_id);
  assert.ok(rr.version);
  assert.deepEqual(Uint8Array.from(rr.socket_addr), requester);
  ws.close();
});

test('a second tab takes the code over and the first one is told so', async () => {
  const first = await connect(validCookie);
  await waitFor(() => first.inbox.find((m) => m.t === 'state'));
  const second = await connect(validCookie);
  assert.equal(await first.closed, 4409);
  await waitFor(() => second.inbox.find((m) => m.t === 'state'));
  second.ws.close();
});

test('signing out elsewhere ends the registration', async () => {
  const { closed } = await connect(validCookie);
  validCookie = 'asw_session=rotated';
  assert.equal(await closed, 4401);
  validCookie = 'asw_session=good';
});
