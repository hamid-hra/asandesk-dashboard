// پیدا کردن دستگاه مقصد از راه سرور شناسه و رسیدن به آن از راه رله (مرورگر مستقیم وصل نمی‌شود).
//
// ۱. PunchHoleRequest با force_relay به وب‌سوکت سرور شناسه (hbbs، درگاه 21118).
// ۲. دستگاه مقصد به رله وصل می‌شود و RelayResponse (uuid، نشانی رله و کلید عمومی امضاشدهٔ مقصد) از راه
//    hbbs به ما می‌رسد.
// ۳. با همان uuid به وب‌سوکت رله (hbbr، درگاه 21119) وصل می‌شویم؛ رله دو طرف را به هم می‌رساند.
// ۴. دست‌دادن رمزنگاری (secureAsInitiator).
import type { WebConfig } from '../api';
import {
  KX_VERSION_LATEST, StreamCipher, b64decode, boxKeyPair, openSigned, randomBytes, sealKey,
} from './crypto';
import { WsTransport } from './transport';
import {
  ConnType, NatType, PROTOCOL_VERSION, PunchFailure, decodeIdPk, decodeRendezvous, type Msg,
} from './proto';

export class ConnectError extends Error {
  /** کلید پیام فارسی در i18n */
  key: string;

  constructor(key: string, detail = '') {
    super(detail || key);
    this.key = key;
  }
}

/** نشانی وب‌سوکت رله‌ای که مقصد انتخاب کرده (از روی نام میزبان آن رله) */
export function relayWsUrl(cfg: WebConfig, relayServer: string): string {
  const host = relayServer.replace(/^\[|\]$/g, '').split(':')[0].trim();
  return (host && cfg.relay_ws_map[host]) || cfg.relay_ws;
}

function uuidv4(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function openIdServer(cfg: WebConfig): Promise<WsTransport> {
  try {
    return await WsTransport.open(cfg.id_ws);
  } catch {
    throw new ConnectError('err_id_server');
  }
}

async function nextRendezvous(ws: WsTransport): Promise<Msg> {
  try {
    return decodeRendezvous(await ws.next(25000));
  } catch {
    throw new ConnectError('err_peer_timeout');
  }
}

/** مرحلهٔ ۱ و ۲: پاسخ RelayResponse یا خطا */
async function requestRelay(cfg: WebConfig, peerId: string): Promise<Msg> {
  const ws = await openIdServer(cfg);
  let fallback: { relayServer: string; pk: Uint8Array } | null = null;
  try {
    ws.sendRendezvous({
      punch_hole_request: {
        id: peerId,
        nat_type: NatType.SYMMETRIC,
        licence_key: cfg.key,
        conn_type: ConnType.DEFAULT_CONN,
        version: PROTOCOL_VERSION,
        force_relay: true,
      },
    });
    const msg = await nextRendezvous(ws);
    if (msg.relay_response) {
      const rr = msg.relay_response;
      if (rr.refuse_reason) throw new ConnectError('err_refused', rr.refuse_reason);
      return rr;
    }
    const ph = msg.punch_hole_response;
    if (!ph) throw new ConnectError('err_peer_timeout');
    if (ph.other_failure) throw new ConnectError('err_other', ph.other_failure);
    if (!ph.socket_addr || ph.socket_addr.length === 0) {
      switch (ph.failure) {
        case PunchFailure.OFFLINE:
          throw new ConnectError('err_offline');
        case PunchFailure.LICENSE_MISMATCH:
          throw new ConnectError('err_key_mismatch');
        case PunchFailure.LICENSE_OVERUSE:
          throw new ConnectError('err_overuse');
        default:
          throw new ConnectError('err_not_exist');
      }
    }
    // مقصد به‌جای رله سوراخ‌زنی کرده (فقط نسخه‌های خیلی قدیمی): رله را خودمان می‌خواهیم. کلید عمومی
    // امضاشده فقط در همین پاسخ است و RelayResponse بعدی آن را ندارد.
    fallback = { relayServer: ph.relay_server || '', pk: ph.pk };
  } finally {
    ws.close();
  }
  // hbbs پاسخ هر درخواست را به اتصال تازه‌ای که آن را فرستاده برمی‌گرداند، پس اتصال جدا لازم است
  const ws2 = await openIdServer(cfg);
  const uuid = uuidv4();
  try {
    ws2.sendRendezvous({
      request_relay: {
        id: peerId,
        uuid,
        relay_server: fallback.relayServer,
        secure: true,
        licence_key: cfg.key,
        conn_type: ConnType.DEFAULT_CONN,
      },
    });
    const next = await nextRendezvous(ws2);
    const rr = next.relay_response;
    if (!rr) throw new ConnectError('err_peer_timeout');
    if (rr.refuse_reason) throw new ConnectError('err_refused', rr.refuse_reason);
    // در این مسیر مقصد uuid و رله را تکرار نمی‌کند؛ همان‌هایی است که خودمان فرستادیم
    return { ...rr, uuid: rr.uuid || uuid, relay_server: rr.relay_server || fallback.relayServer, pk: fallback.pk };
  } finally {
    ws2.close();
  }
}

/** شناسهٔ دستگاه و کلید Ed25519 آن، اگر امضای سرور شناسه درست باشد */
function verifyPeerPk(cfg: WebConfig, peerId: string, signed: Uint8Array | undefined): Uint8Array | null {
  if (!signed || signed.length === 0) return null;
  let rsPk: Uint8Array;
  try {
    rsPk = b64decode(cfg.key);
  } catch {
    return null;
  }
  const opened = openSigned(signed, rsPk);
  if (!opened) return null;
  const idpk = decodeIdPk(opened);
  return idpk.id === peerId && idpk.pk.length === 32 ? idpk.pk : null;
}

/** دست‌دادن از طرف کنترل‌کننده (Client::secure_connection). بدون هویت تأییدشده اتصال را ادامه نمی‌دهیم. */
export async function secureAsInitiator(conn: WsTransport, peerId: string, signPk: Uint8Array) {
  const first = await conn.nextMessage(20000).catch(() => {
    throw new ConnectError('err_handshake');
  });
  if (!first.signed_id) throw new ConnectError('err_handshake');
  const opened = openSigned(first.signed_id.id, signPk);
  if (!opened) throw new ConnectError('err_handshake', 'signature mismatch');
  const idpk = decodeIdPk(opened);
  if (idpk.id !== peerId || idpk.pk.length !== 32) throw new ConnectError('err_handshake', 'id mismatch');
  const ours = boxKeyPair();
  const key = randomBytes(32);
  const sealed = sealKey(key, idpk.pk, ours.secretKey);
  const picked = Math.min(idpk.kx_version, KX_VERSION_LATEST);
  conn.send({ public_key: { asymmetric_value: ours.publicKey, symmetric_value: sealed, kx_version: picked } });
  conn.setCipher(
    StreamCipher.negotiated(key, true, {
      initiatorPk: ours.publicKey,
      responderPk: idpk.pk,
      advertised: idpk.kx_version,
      picked,
    }),
  );
}

/** اتصال کامل و رمزشده به دستگاه `peerId` */
export async function connectToPeer(cfg: WebConfig, peerId: string): Promise<WsTransport> {
  const rr = await requestRelay(cfg, peerId);
  const signPk = verifyPeerPk(cfg, peerId, rr.pk);
  if (!signPk) throw new ConnectError('err_insecure');
  let conn: WsTransport;
  try {
    conn = await WsTransport.open(relayWsUrl(cfg, rr.relay_server || ''));
  } catch {
    throw new ConnectError('err_relay');
  }
  try {
    conn.sendRendezvous({
      request_relay: { licence_key: cfg.key, uuid: rr.uuid, conn_type: ConnType.DEFAULT_CONN },
    });
    await secureAsInitiator(conn, peerId, signPk);
    return conn;
  } catch (e) {
    conn.close();
    throw e;
  }
}
