// خواندن و نوشتن پیام‌های protobuf بدون eval (CSP سایت 'unsafe-eval' ندارد)، از روی شمای proto/schema.mjs.
//
// قاعده‌ها همان protobufjs است تا خروجی بایت‌به‌بایت یکی باشد (test/pb.test.ts): فیلدها به ترتیب شماره، فیلدی
// که در شیء هست (حتی صفر) نوشته می‌شود، عددهای تکراری فشرده‌اند. در خواندن، فیلدهای ساده مقدار پیش‌فرض
// proto3 می‌گیرند (۰، ""، false، بایت خالی)، پیام‌ها null و فهرست‌ها []؛ برای هر oneof نام فیلد پرشده در
// خاصیتی به نام همان oneof (معمولا `union`) گذاشته می‌شود.
type Field = [string, number, string, string | null, number, number, string | null];
export type Schema = Record<string, { f: Field[] }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const VARINT = 0;
const I64 = 1;
const LEN = 2;
const I32 = 5;

const WIRE: Record<string, number> = {
  double: I64, fixed64: I64, sfixed64: I64,
  float: I32, fixed32: I32, sfixed32: I32,
  string: LEN, bytes: LEN, message: LEN,
};

const utf8enc = new TextEncoder();
const utf8dec = new TextDecoder();

class Writer {
  private buf = new Uint8Array(64);
  len = 0;

  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(b: number) {
    this.ensure(1);
    this.buf[this.len++] = b;
  }

  /** بدون علامت تا ۳۲ بیت */
  uint32(v: number) {
    v >>>= 0;
    while (v > 0x7f) {
      this.byte((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.byte(v);
  }

  /** ۶۴ بیتی، به شکل bigint بی‌علامت */
  varint64(v: bigint) {
    v = BigInt.asUintN(64, v);
    while (v > 0x7fn) {
      this.byte(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.byte(Number(v));
  }

  tag(id: number, wire: number) {
    this.uint32((id << 3) | wire);
  }

  raw(bytes: Uint8Array) {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  lenDelimited(bytes: Uint8Array) {
    this.uint32(bytes.length);
    this.raw(bytes);
  }

  fixed(bytesLen: number, fill: (dv: DataView) => void) {
    this.ensure(bytesLen);
    fill(new DataView(this.buf.buffer, this.len, bytesLen));
    this.len += bytesLen;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class Reader {
  pos = 0;
  private buf: Uint8Array;
  private end: number;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }

  get done() {
    return this.pos >= this.end;
  }

  varint64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error('truncated varint');
      const b = this.buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) return BigInt.asUintN(64, result);
      shift += 7n;
    }
    throw new Error('varint too long');
  }

  uint32(): number {
    return Number(BigInt.asUintN(32, this.varint64()));
  }

  bytes(): Uint8Array {
    const n = this.uint32();
    if (this.pos + n > this.end) throw new Error('truncated bytes');
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  sub(): Reader {
    const n = this.uint32();
    if (this.pos + n > this.end) throw new Error('truncated message');
    const r = new Reader(this.buf, this.pos, this.pos + n);
    this.pos += n;
    return r;
  }

  fixed(n: number): DataView {
    if (this.pos + n > this.end) throw new Error('truncated fixed');
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, n);
    this.pos += n;
    return dv;
  }

  skip(wire: number) {
    switch (wire) {
      case VARINT:
        this.varint64();
        break;
      case I64:
        this.fixed(8);
        break;
      case LEN:
        this.bytes();
        break;
      case I32:
        this.fixed(4);
        break;
      default:
        throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

function wireOf(kind: string): number {
  return WIRE[kind] ?? VARINT;
}

function writeScalar(w: Writer, kind: string, v: unknown) {
  switch (kind) {
    case 'int32':
    case 'enum':
      // منفی‌ها ده بایتی (مثل protobuf)
      w.varint64(BigInt(Math.trunc(Number(v)) | 0));
      break;
    case 'uint32':
      w.uint32(Number(v));
      break;
    case 'sint32': {
      const n = Number(v) | 0;
      w.uint32(((n << 1) ^ (n >> 31)) >>> 0);
      break;
    }
    case 'int64':
    case 'uint64':
      w.varint64(BigInt(typeof v === 'bigint' ? v : Math.trunc(Number(v))));
      break;
    case 'sint64': {
      const n = BigInt(typeof v === 'bigint' ? v : Math.trunc(Number(v)));
      w.varint64((n << 1n) ^ (n >> 63n));
      break;
    }
    case 'bool':
      w.byte(v ? 1 : 0);
      break;
    case 'double':
      w.fixed(8, (dv) => dv.setFloat64(0, Number(v), true));
      break;
    case 'float':
      w.fixed(4, (dv) => dv.setFloat32(0, Number(v), true));
      break;
    case 'fixed32':
      w.fixed(4, (dv) => dv.setUint32(0, Number(v) >>> 0, true));
      break;
    case 'sfixed32':
      w.fixed(4, (dv) => dv.setInt32(0, Number(v) | 0, true));
      break;
    case 'fixed64':
    case 'sfixed64':
      w.fixed(8, (dv) => dv.setBigUint64(0, BigInt.asUintN(64, BigInt(typeof v === 'bigint' ? v : Math.trunc(Number(v)))), true));
      break;
    case 'string':
      w.lenDelimited(utf8enc.encode(String(v)));
      break;
    case 'bytes':
      w.lenDelimited(v instanceof Uint8Array ? v : Uint8Array.from(v as ArrayLike<number>));
      break;
    default:
      throw new Error(`unknown field type ${kind}`);
  }
}

function readScalar(r: Reader, kind: string): unknown {
  switch (kind) {
    case 'int32':
    case 'enum':
      return Number(BigInt.asIntN(32, r.varint64()));
    case 'uint32':
      return r.uint32();
    case 'sint32': {
      const n = r.uint32();
      return (n >>> 1) ^ -(n & 1);
    }
    case 'int64':
      return Number(BigInt.asIntN(64, r.varint64()));
    case 'uint64':
      return Number(r.varint64());
    case 'sint64': {
      const n = r.varint64();
      return Number((n >> 1n) ^ -(n & 1n));
    }
    case 'bool':
      return r.varint64() !== 0n;
    case 'double':
      return r.fixed(8).getFloat64(0, true);
    case 'float':
      return r.fixed(4).getFloat32(0, true);
    case 'fixed32':
      return r.fixed(4).getUint32(0, true);
    case 'sfixed32':
      return r.fixed(4).getInt32(0, true);
    case 'fixed64':
      return Number(r.fixed(8).getBigUint64(0, true));
    case 'sfixed64':
      return Number(r.fixed(8).getBigInt64(0, true));
    case 'string':
      return utf8dec.decode(r.bytes());
    case 'bytes':
      return r.bytes();
    default:
      throw new Error(`unknown field type ${kind}`);
  }
}

/** مقدار پیش‌فرض proto3 روی سیم نوشته نمی‌شود (مثل protobufjs و برنامهٔ دسکتاپ)، مگر عضو oneof باشد */
function isDefault(kind: string, v: unknown): boolean {
  switch (kind) {
    case 'message':
      return false;
    case 'string':
      return v === '';
    case 'bytes':
      return (v as ArrayLike<number>).length === 0;
    case 'bool':
      return !v;
    default:
      return typeof v === 'bigint' ? v === 0n : Number(v) === 0 && !Object.is(Number(v), -0);
  }
}

function defaultOf(kind: string): unknown {
  switch (kind) {
    case 'string':
      return '';
    case 'bytes':
      return new Uint8Array();
    case 'bool':
      return false;
    case 'message':
      return null;
    default:
      return 0;
  }
}

export class Codec {
  private schema: Schema;
  private sorted = new Map<string, Field[]>();
  private byId = new Map<string, Map<number, Field>>();

  constructor(schema: Schema) {
    this.schema = schema;
  }

  private fields(type: string): Field[] {
    let f = this.sorted.get(type);
    if (!f) {
      const t = this.schema[type];
      if (!t) throw new Error(`unknown message type ${type}`);
      f = [...t.f].sort((a, b) => a[1] - b[1]);
      this.sorted.set(type, f);
      this.byId.set(type, new Map(f.map((x) => [x[1], x])));
    }
    return f;
  }

  encode(type: string, obj: Obj): Uint8Array {
    const w = new Writer();
    this.write(w, type, obj);
    return w.finish();
  }

  private write(w: Writer, type: string, obj: Obj) {
    for (const [name, id, kind, sub, repeated, packed, oneof] of this.fields(type)) {
      const v = obj[name];
      if (v === undefined || v === null) continue;
      if (!repeated && !oneof && isDefault(kind, v)) continue;
      if (repeated) {
        const list = v as unknown[];
        if (!list.length) continue;
        if (packed) {
          const inner = new Writer();
          for (const x of list) writeScalar(inner, kind, x);
          w.tag(id, LEN);
          w.lenDelimited(inner.finish());
        } else {
          for (const x of list) this.writeOne(w, id, kind, sub, x);
        }
      } else {
        this.writeOne(w, id, kind, sub, v);
      }
    }
  }

  private writeOne(w: Writer, id: number, kind: string, sub: string | null, v: unknown) {
    if (kind === 'message') {
      const inner = new Writer();
      this.write(inner, sub!, v as Obj);
      w.tag(id, LEN);
      w.lenDelimited(inner.finish());
      return;
    }
    w.tag(id, wireOf(kind));
    writeScalar(w, kind, v);
  }

  decode(type: string, bytes: Uint8Array): Obj {
    return this.read(new Reader(bytes), type);
  }

  private read(r: Reader, type: string): Obj {
    const fields = this.fields(type);
    const ids = this.byId.get(type)!;
    const obj: Obj = {};
    for (const [name, , kind, , repeated, , oneof] of fields) {
      if (repeated) obj[name] = [];
      else if (!oneof) obj[name] = defaultOf(kind);
    }
    while (!r.done) {
      const key = r.uint32();
      const id = key >>> 3;
      const wire = key & 7;
      const f = ids.get(id);
      if (!f) {
        r.skip(wire);
        continue;
      }
      const [name, , kind, sub, repeated, , oneof] = f;
      if (kind === 'message') {
        if (wire !== LEN) {
          r.skip(wire);
          continue;
        }
        const value = this.read(r.sub(), sub!);
        if (repeated) obj[name].push(value);
        else obj[name] = value;
      } else if (repeated && wire === LEN && wireOf(kind) !== LEN) {
        // فهرست فشرده
        const pr = r.sub();
        while (!pr.done) obj[name].push(readScalar(pr, kind));
      } else if (wire !== wireOf(kind)) {
        r.skip(wire);
        continue;
      } else {
        const value = readScalar(r, kind);
        if (repeated) obj[name].push(value);
        else obj[name] = value;
      }
      if (oneof) obj[oneof] = name;
    }
    return obj;
  }
}
