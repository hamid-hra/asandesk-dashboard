// پیام‌های سرور شناسه (همان proto/rendezvous.proto برنامهٔ دسکتاپ)
import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';

(protobuf.util as { Long: unknown }).Long = null;
protobuf.configure();

const root = new protobuf.Root();
protobuf.parse(readFileSync(new URL('../proto/rendezvous.proto', import.meta.url), 'utf8'), root, { keepCase: true });
root.resolveAll();
const Rendezvous = root.lookupType('hbb.RendezvousMessage');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = Record<string, any>;

export function encode(obj: Msg): Uint8Array {
  return Rendezvous.encode(Rendezvous.fromObject(obj)).finish();
}

export function decode(bytes: Uint8Array): Msg {
  return Rendezvous.decode(bytes) as unknown as Msg;
}

export const RegisterPkResult = {
  OK: 0, UUID_MISMATCH: 2, ID_EXISTS: 3, TOO_FREQUENT: 4, INVALID_ID_FORMAT: 5, NOT_SUPPORT: 6, SERVER_ERROR: 7, NOT_DEPLOYED: 8,
} as const;

/** سرآیند طول پیام روی TCP (hbb_common/src/bytes_codec.rs) */
export function frame(data: Uint8Array): Uint8Array {
  const n = data.length;
  let head: number[];
  if (n <= 0x3f) head = [n << 2];
  else if (n <= 0x3fff) {
    const h = (n << 2) | 0x1;
    head = [h & 0xff, (h >> 8) & 0xff];
  } else if (n <= 0x3fffff) {
    const h = (n << 2) | 0x2;
    head = [h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff];
  } else {
    const h = ((n << 2) | 0x3) >>> 0;
    head = [h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff, (h >>> 24) & 0xff];
  }
  const out = new Uint8Array(head.length + n);
  out.set(head, 0);
  out.set(data, head.length);
  return out;
}

/** خواندن پیام‌های قاب‌بندی‌شده از یک بافر TCP (برای آزمون‌ها) */
export function unframe(buf: Uint8Array): { messages: Uint8Array[]; rest: Uint8Array } {
  const messages: Uint8Array[] = [];
  let off = 0;
  while (off < buf.length) {
    const headLen = (buf[off] & 0x3) + 1;
    if (buf.length - off < headLen) break;
    let n = 0;
    for (let i = headLen - 1; i >= 0; i--) n = n * 256 + buf[off + i];
    n = Math.floor(n / 4);
    if (buf.length - off - headLen < n) break;
    messages.push(buf.slice(off + headLen, off + headLen + n));
    off += headLen + n;
  }
  return { messages, rest: buf.slice(off) };
}
