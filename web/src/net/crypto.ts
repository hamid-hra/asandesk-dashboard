// رمزنگاری سرتاسری اتصال، سازگار با hbb_common برنامهٔ دسکتاپ (libs/hbb_common/src/tcp.rs)
//
// دست‌دادن: طرف کنترل‌شونده هویتش (IdPk امضاشده با کلید Ed25519 خودش) را می‌فرستد؛ کنترل‌کننده با کلید
// عمومی‌ای که سرور شناسه امضا کرده آن را بررسی می‌کند، یک کلید ۳۲ بایتی تصادفی می‌سازد و آن را با
// crypto_box (nonce صفر) برای کلید موقت طرف مقابل می‌فرستد. از آن به بعد هر پیام با secretbox و nonce
// برابر شمارندهٔ پیام (جدا برای ارسال و دریافت) رمز می‌شود.
//
// نسخهٔ ۱ دست‌دادن (kx_version=1) کلید را برای هر جهت جدا می‌کند: زیرکلید = BLAKE2b-256 با کلید مشترک
// روی "rdkx-spl" ‖ جهت ‖ نسخهٔ اعلام‌شده ‖ نسخهٔ انتخاب‌شده ‖ کلید موقت آغازگر ‖ کلید موقت پاسخ‌دهنده.
import nacl from 'tweetnacl';
import { blake2b } from '@noble/hashes/blake2.js';

export const KX_VERSION_LATEST = 1;
const SPLIT_CONTEXT = new TextEncoder().encode('rdkx-spl');
const SPLIT_INITIATOR = 1;
const SPLIT_RESPONDER = 2;
const ZERO_NONCE = new Uint8Array(nacl.box.nonceLength);

export function b64decode(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** sign::verify سدیوم (امضای چسبیده به پیام). امضای نادرست → null */
export function openSigned(signed: Uint8Array, pk: Uint8Array): Uint8Array | null {
  if (pk.length !== nacl.sign.publicKeyLength) return null;
  return nacl.sign.open(signed, pk);
}

export function signCombined(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign(message, secretKey);
}

export function signKeyPairFromSeed(seed: Uint8Array): nacl.SignKeyPair {
  return nacl.sign.keyPair.fromSeed(seed);
}

export function boxKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

/** کلید متقارن تصادفی، بسته‌شده برای کلید موقت طرف مقابل (create_symmetric_key_msg) */
export function sealKey(key: Uint8Array, theirPk: Uint8Array, ourSk: Uint8Array): Uint8Array {
  return nacl.box(key, ZERO_NONCE, theirPk, ourSk);
}

/** Encrypt::decode: بازکردن کلید متقارنی که آغازگر فرستاده */
export function openKey(sealed: Uint8Array, theirPk: Uint8Array, ourSk: Uint8Array): Uint8Array | null {
  if (theirPk.length !== nacl.box.publicKeyLength) return null;
  const key = nacl.box.open(sealed, ZERO_NONCE, theirPk, ourSk);
  return key && key.length === nacl.secretbox.keyLength ? key : null;
}

function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

export interface KxTranscript {
  initiatorPk: Uint8Array;
  responderPk: Uint8Array;
  advertised: number;
  picked: number;
}

function deriveSubkey(key: Uint8Array, direction: number, t: KxTranscript): Uint8Array {
  const parts = [SPLIT_CONTEXT, new Uint8Array([direction]), u32le(t.advertised), u32le(t.picked), t.initiatorPk, t.responderPk];
  const len = parts.reduce((n, p) => n + p.length, 0);
  const data = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    data.set(p, off);
    off += p.length;
  }
  return blake2b(data, { key, dkLen: 32 });
}

function nonceFor(seq: number): Uint8Array {
  const n = new Uint8Array(nacl.secretbox.nonceLength);
  new DataView(n.buffer).setBigUint64(0, BigInt(seq), true);
  return n;
}

/** وضعیت رمزنگاری یک اتصال: کلید و شمارندهٔ هر جهت */
export class StreamCipher {
  private sendSeq = 0;
  private recvSeq = 0;
  private sendKey: Uint8Array;
  private recvKey: Uint8Array;

  private constructor(sendKey: Uint8Array, recvKey: Uint8Array) {
    this.sendKey = sendKey;
    this.recvKey = recvKey;
  }

  /** `isInitiator`: طرفی که کلید بسته‌شده را فرستاده (کنترل‌کننده) */
  static negotiated(key: Uint8Array, isInitiator: boolean, t: KxTranscript): StreamCipher {
    if (t.picked === 0) return new StreamCipher(key, key);
    if (t.picked !== 1) throw new Error(`key exchange version ${t.picked} not supported`);
    const initiator = deriveSubkey(key, SPLIT_INITIATOR, t);
    const responder = deriveSubkey(key, SPLIT_RESPONDER, t);
    return isInitiator ? new StreamCipher(initiator, responder) : new StreamCipher(responder, initiator);
  }

  encrypt(data: Uint8Array): Uint8Array {
    this.sendSeq += 1;
    return nacl.secretbox(data, nonceFor(this.sendSeq), this.sendKey);
  }

  /** مثل Encrypt::dec: پیام یک‌بایتی یا خالی رمز ندارد */
  decrypt(data: Uint8Array): Uint8Array {
    if (data.length <= 1) return data;
    this.recvSeq += 1;
    const out = nacl.secretbox.open(data, nonceFor(this.recvSeq), this.recvKey);
    if (!out) throw new Error('decryption error');
    return out;
  }
}

export async function sha256(...parts: (Uint8Array | string)[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const data = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    data.set(c, off);
    off += c.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** رمز ورود: sha256(sha256(رمز + salt) + challenge) — همان LoginRequest.password برنامهٔ دسکتاپ */
export async function passwordH1(password: string, salt: string): Promise<Uint8Array> {
  return sha256(password, salt);
}

export async function loginHash(h1: Uint8Array, challenge: string): Promise<Uint8Array> {
  return sha256(h1, challenge);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
