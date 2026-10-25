// شِمای پیام‌ها برای مرورگر، هنگام بیلد از روی همان فایل‌های .proto برنامهٔ دسکتاپ ساخته می‌شود.
//
// protobufjs در مرورگر رمزگذار/رمزگشا را با new Function می‌سازد و CSP سایت (بدون 'unsafe-eval') جلویش را
// می‌گیرد؛ پس protobufjs فقط این‌جا (در Node، هنگام بیلد و آزمون) پرونده‌ها را می‌خواند و مرورگر فقط این
// فهرست ساده را می‌گیرد (src/net/pb.ts آن را بدون eval می‌خواند و می‌نویسد).
//
// قالب: { "hbb.Message": { f: [[نام، شماره، نوع، نام نوع پیام/شمارشی یا null، تکراری؟، فشرده؟، oneof یا null], ...] } }
// نوع: یکی از نوع‌های ساده (int32، bytes، ...) یا "message" یا "enum".
import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';

const FILES = ['message.proto', 'rendezvous.proto'];

export function buildSchema(dir = new URL('.', import.meta.url)) {
  const root = new protobuf.Root();
  for (const f of FILES) protobuf.parse(readFileSync(new URL(f, dir), 'utf8'), root, { keepCase: true });
  root.resolveAll();
  const out = {};
  const walk = (ns) => {
    for (const obj of ns.nestedArray || []) {
      if (obj instanceof protobuf.Type) {
        out[obj.fullName.slice(1)] = {
          f: obj.fieldsArray.map((fld) => {
            const rt = fld.resolvedType;
            const kind = rt instanceof protobuf.Enum ? 'enum' : rt ? 'message' : fld.type;
            // protobufjs پیام‌ها و رشته‌های تکراری را هم packed می‌نامد؛ فشرده‌سازی فقط برای عدد و شمارشی است
            const packable = !['message', 'string', 'bytes'].includes(kind);
            return [fld.name, fld.id, kind, rt ? rt.fullName.slice(1) : null, fld.repeated ? 1 : 0, fld.repeated && fld.packed && packable ? 1 : 0, fld.partOf ? fld.partOf.name : null];
          }),
        };
      }
      if (obj.nestedArray) walk(obj);
    }
  };
  walk(root);
  return out;
}
