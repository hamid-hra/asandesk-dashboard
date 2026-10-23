// درگاه وب آسان دسک (سرویس webgw در docker compose)
//
// مرورگر کاربر واردشده با وب‌سوکت /ws/gw به این‌جا وصل می‌شود (nginx کوکی او را هم می‌فرستد). درگاه با همان
// کوکی از backend می‌پرسد این کاربر کیست (GET /api/web/me/peer)، کد او را در hbbs ثبت می‌کند و تا وقتی
// زبانه باز است آنلاین نگهش می‌دارد. اگر کسی کد را وارد کند، uuid رله برای مرورگر فرستاده می‌شود؛ بقیهٔ
// اتصال (دست‌دادن رمزنگاری و تصویر) مستقیم بین مرورگر و رله است و از این سرویس نمی‌گذرد.
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Registration, type GwConfig, type PeerIdentity, type RegState } from './registration.ts';

export interface ServerOptions extends GwConfig {
  port: number;
  backendUrl: string;
  revalidateMs: number;
  maxOnline: number;
  maxPerIp: number;
  graceMs: number;
}

interface Entry {
  reg: Registration;
  active: WebSocket | null;
  cookie: string;
  ip: string;
  revalidate: NodeJS.Timeout;
  grace: NodeJS.Timeout | null;
}

const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_REPLACED = 4409;
const CLOSE_BUSY = 4429;

function send(ws: WebSocket | null, obj: object) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/** هویت همتای کاربر از backend با کوکی خود او. 401 → null، خطای شبکه → throw */
export async function whoIs(backendUrl: string, cookie: string, ip: string): Promise<PeerIdentity | null> {
  const res = await fetch(`${backendUrl}/api/web/me/peer`, {
    headers: { cookie, 'x-real-ip': ip, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`backend answered ${res.status}`);
  const data = (await res.json()) as { web_id?: string; uuid?: string; pk?: string };
  if (!data.web_id || !data.uuid || !data.pk) throw new Error('backend answer is incomplete');
  return { webId: data.web_id, uuid: data.uuid, pk: data.pk };
}

export interface Gateway {
  server: http.Server;
  close(): void;
}

export function startServer(opts: ServerOptions): Gateway {
  const entries = new Map<string, Entry>();
  const perIp = new Map<string, number>();

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ok ${entries.size}\n`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  const drop = (webId: string, entry: Entry) => {
    clearInterval(entry.revalidate);
    if (entry.grace) clearTimeout(entry.grace);
    entry.reg.stop();
    if (entries.get(webId) === entry) entries.delete(webId);
  };

  const attach = (ws: WebSocket, peer: PeerIdentity, cookie: string, ip: string) => {
    let entry = entries.get(peer.webId);
    if (entry) {
      if (entry.active && entry.active !== ws) entry.active.close(CLOSE_REPLACED, 'replaced');
      if (entry.grace) clearTimeout(entry.grace);
      entry.grace = null;
      entry.active = ws;
      entry.cookie = cookie;
      entry.ip = ip;
      send(ws, { t: 'state', state: entry.reg.state });
    } else {
      if (entries.size >= opts.maxOnline) {
        ws.close(CLOSE_BUSY, 'busy');
        return;
      }
      const reg = new Registration(opts, peer, {
        onState: (state: RegState) => send(entries.get(peer.webId)?.active ?? null, { t: 'state', state }),
        onIncoming: (uuid, relayServer) => {
          const active = entries.get(peer.webId)?.active ?? null;
          send(active, { t: 'incoming', uuid, relay_server: relayServer });
        },
      });
      const created: Entry = {
        reg,
        active: ws,
        cookie,
        ip,
        grace: null,
        revalidate: setInterval(async () => {
          // ورود باطل یا حساب مسدود شد: کد از hbbs برداشته می‌شود (با قطع RegisterPeer)
          try {
            const who = await whoIs(opts.backendUrl, created.cookie, created.ip);
            if (who === null || who.webId !== peer.webId) {
              created.active?.close(CLOSE_UNAUTHORIZED, 'unauthorized');
              drop(peer.webId, created);
            }
          } catch {
            /* backend در دسترس نیست؛ دفعهٔ بعد */
          }
        }, opts.revalidateMs),
      };
      entries.set(peer.webId, created);
      entry = created;
      send(ws, { t: 'state', state: 'connecting' });
      reg.start();
      opts.log(`online: ${peer.webId} (${entries.size} codes)`);
    }
    const current = entry;
    ws.on('message', (data) => {
      if (String(data) === '{"t":"ping"}') send(ws, { t: 'pong' });
    });
    ws.on('close', () => {
      if (current.active !== ws) return;
      current.active = null;
      // بارگذاری دوبارهٔ صفحه نباید کد را آفلاین کند
      current.grace = setTimeout(() => {
        if (current.active === null) {
          drop(peer.webId, current);
          opts.log(`offline: ${peer.webId} (${entries.size} codes)`);
        }
      }, opts.graceMs);
    });
  };

  server.on('upgrade', (req, socket, head) => {
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
    const count = perIp.get(ip) ?? 0;
    if (count >= opts.maxPerIp) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, async (ws) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      ws.on('close', () => {
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(ip);
        else perIp.set(ip, n);
      });
      const cookie = String(req.headers.cookie || '');
      let peer: PeerIdentity | null;
      try {
        peer = cookie ? await whoIs(opts.backendUrl, cookie, ip) : null;
      } catch (err) {
        opts.log(`backend check failed: ${(err as Error).message}`);
        ws.close(1011, 'backend unavailable');
        return;
      }
      if (!peer) {
        ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
      if (ws.readyState !== ws.OPEN) return;
      attach(ws, peer, cookie, ip);
    });
  });

  server.listen(opts.port);
  return {
    server,
    close() {
      for (const [id, e] of entries) drop(id, e);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close();
    },
  };
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

if (import.meta.main) {
  const hbbsHost = process.env.HBBS_HOST || 'rd.asandesk.ir';
  const opts: ServerOptions = {
    port: envInt('PORT', 8200),
    backendUrl: (process.env.BACKEND_URL || 'http://backend:8000').replace(/\/$/, ''),
    hbbsHost,
    hbbsPort: envInt('HBBS_PORT', 21116),
    relayServer: process.env.RELAY_SERVER || hbbsHost,
    revalidateMs: envInt('REVALIDATE_SECONDS', 60) * 1000,
    maxOnline: envInt('MAX_ONLINE', 5000),
    maxPerIp: envInt('MAX_PER_IP', 30),
    graceMs: envInt('GRACE_SECONDS', 15) * 1000,
    log: (line) => console.log(`[webgw] ${line}`),
  };
  startServer(opts);
  opts.log(`listening on ${opts.port}; hbbs ${opts.hbbsHost}:${opts.hbbsPort}; relay ${opts.relayServer}`);
}
