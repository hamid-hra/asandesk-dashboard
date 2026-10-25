// رمزگذار بدون eval (src/net/pb.ts) باید همان بایت‌های protobufjs را بسازد و همان را بخواند
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import protobuf from 'protobufjs';
import { Codec } from '../src/net/pb.ts';
import { buildSchema } from '../proto/schema.mjs';

(protobuf.util as { Long: unknown }).Long = null;
protobuf.configure();
const root = new protobuf.Root();
for (const f of ['message.proto', 'rendezvous.proto']) {
  protobuf.parse(readFileSync(new URL(`../proto/${f}`, import.meta.url), 'utf8'), root, { keepCase: true });
}
root.resolveAll();
const codec = new Codec(buildSchema());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37) & 0xff);

const SAMPLES: [string, Record<string, unknown>][] = [
  ['hbb.RendezvousMessage', { punch_hole_request: { id: '3123456789', nat_type: 2, licence_key: 'key=', conn_type: 0, version: '1.5.0', force_relay: true } }],
  ['hbb.RendezvousMessage', { request_relay: { id: 'abc123', uuid: 'u-1', relay_server: 'rd.asandesk.ir', secure: true, licence_key: 'k', conn_type: 0 } }],
  ['hbb.RendezvousMessage', { relay_response: { socket_addr: bytes(18), uuid: 'u', relay_server: 'r', pk: bytes(96), version: '1.5.0' } }],
  ['hbb.RendezvousMessage', { register_pk: { id: '3000000001', uuid: bytes(16), pk: bytes(32) } }],
  ['hbb.RendezvousMessage', { punch_hole_response: { failure: 2, other_failure: '' } }],
  ['hbb.IdPk', { id: '3000000001', pk: bytes(32), kx_version: 1 }],
  ['hbb.Message', { signed_id: { id: bytes(140) } }],
  ['hbb.Message', { public_key: { asymmetric_value: bytes(32), symmetric_value: bytes(48), kx_version: 1 } }],
  ['hbb.Message', { hash: { salt: 'abc', challenge: 'xyz' } }],
  ['hbb.Message', { test_delay: { time: 1792695916579, from_client: true, last_delay: 12 } }],
  ['hbb.Message', {
    login_request: {
      username: '123456789', password: bytes(32), my_id: '3999999999', my_name: 'کارشناس پشتیبانی', my_platform: 'Web',
      version: '1.5.0', session_id: 4503599627370495,
      option: { image_quality: 3, disable_audio: 2, disable_clipboard: 2, supported_decoding: { ability_vp9: 1, ability_vp8: 1, ability_av1: 0, ability_h264: 1, ability_h265: 0, prefer: 0 } },
    },
  }],
  ['hbb.Message', {
    login_response: {
      peer_info: {
        username: 'u', hostname: 'h', platform: 'Windows', current_display: 1, version: '1.5.0',
        displays: [{ x: -1920, y: 0, width: 1920, height: 1080, name: 'A', online: true }, { x: 0, y: -200, width: 2560, height: 1440, name: 'B', cursor_embedded: true, original_resolution: { width: 2560, height: 1440 }, scale: 1.25 }],
        encoding: { vp8: true, h264: false },
      },
    },
  }],
  ['hbb.Message', { login_response: { error: 'Wrong Password' } }],
  ['hbb.Message', { video_frame: { vp9s: { frames: [{ data: bytes(300), key: true, pts: 123456 }, { data: bytes(5), key: false, pts: 0 }] }, display: 0 } }],
  ['hbb.Message', { mouse_event: { mask: 9, x: -15, y: 2047, modifiers: [4, 29, 1] } }],
  ['hbb.Message', { key_event: { control_key: 27, down: true, press: false, modifiers: [4], mode: 0 } }],
  ['hbb.Message', { key_event: { seq: 'سلام', down: true, press: false, mode: 0 } }],
  ['hbb.Message', { key_event: { chr: 99, down: false, press: false, modifiers: [4, 23], mode: 0 } }],
  ['hbb.Message', { misc: { switch_display: { display: 0, x: 0, y: 0, width: 1280, height: 720, cursor_embedded: true } } }],
  ['hbb.Message', { misc: { permission_info: { permission: 0, enabled: false } } }],
  ['hbb.Message', { misc: { option: { image_quality: 4 } } }],
  ['hbb.Message', { misc: { refresh_video: true } }],
  ['hbb.Message', { misc: { close_reason: 'bye' } }],
  ['hbb.Message', { auth_2fa: { code: '123456' } }],
];

test('encodes exactly like protobufjs', () => {
  for (const [type, obj] of SAMPLES) {
    const T = root.lookupType(type);
    assert.equal(hex(codec.encode(type, obj)), hex(T.encode(T.fromObject(obj)).finish()), JSON.stringify(obj).slice(0, 80));
  }
});

test('decodes what protobufjs writes, with proto3 defaults and the oneof name', () => {
  for (const [type, obj] of SAMPLES) {
    const T = root.lookupType(type);
    const wire = T.encode(T.fromObject(obj)).finish();
    const ours = codec.decode(type, wire);
    const theirs = T.toObject(T.decode(wire), { longs: Number, enums: Number, bytes: Array, defaults: true, oneofs: true, arrays: true });
    const norm = (v: unknown): unknown =>
      v instanceof Uint8Array ? Array.from(v) : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v;
    // protobufjs پیام‌های خالی را حذف می‌کند و ما null می‌گذاریم؛ فقط فیلدهایی که protobufjs دارد مقایسه می‌شوند
    const pick = (a: unknown, b: unknown): unknown => {
      if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object') {
        return Object.fromEntries(Object.keys(b).map((k) => [k, pick((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])]));
      }
      if (Array.isArray(b) && Array.isArray(a)) return a.map((x, i) => pick(x, b[i]));
      return a;
    };
    assert.deepEqual(pick(norm(ours), theirs), theirs, JSON.stringify(obj).slice(0, 80));
  }
});

test('reads a zero-valued field the peer left out (Keyboard permission is 0)', () => {
  const m = codec.decode('hbb.Message', codec.encode('hbb.Message', { misc: { permission_info: { enabled: true } } }));
  assert.equal(m.union, 'misc');
  assert.equal(m.misc.union, 'permission_info');
  assert.equal(m.misc.permission_info.permission, 0);
  assert.equal(m.video_frame, undefined);
});
