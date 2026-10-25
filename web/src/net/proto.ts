// پیام‌های پروتکل آسان دسک (همان فایل‌های .proto برنامهٔ دسکتاپ؛ شمای آن‌ها هنگام بیلد از proto/schema.mjs می‌آید)
import schema from 'virtual:asan-proto-schema';
import { Codec, type Schema } from './pb';

const codec = new Codec(schema as Schema);

// شکل پیام‌ها آزاد است (همان نام فیلدهای .proto)؛ فقط بخش‌هایی که این برنامه می‌خواند نوع دارند
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = Record<string, any>;

export function encodeMessage(obj: Msg): Uint8Array {
  return codec.encode('hbb.Message', obj);
}

export function decodeMessage(bytes: Uint8Array): Msg {
  return codec.decode('hbb.Message', bytes);
}

export function encodeRendezvous(obj: Msg): Uint8Array {
  return codec.encode('hbb.RendezvousMessage', obj);
}

export function decodeRendezvous(bytes: Uint8Array): Msg {
  return codec.decode('hbb.RendezvousMessage', bytes);
}

export function encodeIdPk(obj: { id: string; pk: Uint8Array; kx_version?: number }): Uint8Array {
  return codec.encode('hbb.IdPk', obj);
}

export function decodeIdPk(bytes: Uint8Array): { id: string; pk: Uint8Array; kx_version: number } {
  const m = codec.decode('hbb.IdPk', bytes);
  return { id: m.id || '', pk: m.pk || new Uint8Array(), kx_version: m.kx_version || 0 };
}

/** نسخه‌ای که به طرف مقابل اعلام می‌شود (همان نسخهٔ برنامهٔ دسکتاپ این پروتکل) */
export const PROTOCOL_VERSION = '1.5.0';

export const NatType = { UNKNOWN_NAT: 0, ASYMMETRIC: 1, SYMMETRIC: 2 } as const;
export const ConnType = { DEFAULT_CONN: 0 } as const;
export const PunchFailure = { ID_NOT_EXIST: 0, OFFLINE: 2, LICENSE_MISMATCH: 3, LICENSE_OVERUSE: 4 } as const;
export const BoolOption = { NotSet: 0, No: 1, Yes: 2 } as const;
export const ImageQuality = { NotSet: 0, Low: 2, Balanced: 3, Best: 4 } as const;
export const PreferCodec = { Auto: 0, VP9: 1, H264: 2, H265: 3, VP8: 4, AV1: 5 } as const;
export const KeyboardMode = { Legacy: 0, Map: 1, Translate: 2 } as const;
export const Permission = { Keyboard: 0, Clipboard: 2, Audio: 3, File: 4, Restart: 5, Recording: 6, BlockInput: 7 } as const;

export const ControlKey = {
  Alt: 1, Backspace: 2, CapsLock: 3, Control: 4, Delete: 5, DownArrow: 6, End: 7, Escape: 8,
  F1: 9, F10: 10, F11: 11, F12: 12, F2: 13, F3: 14, F4: 15, F5: 16, F6: 17, F7: 18, F8: 19, F9: 20,
  Home: 21, LeftArrow: 22, Meta: 23, PageDown: 25, PageUp: 26, Return: 27, RightArrow: 28, Shift: 29,
  Space: 30, Tab: 31, UpArrow: 32, Numpad0: 33, Numpad1: 34, Numpad2: 35, Numpad3: 36, Numpad4: 37,
  Numpad5: 38, Numpad6: 39, Numpad7: 40, Numpad8: 41, Numpad9: 42, Pause: 46, Insert: 58, Scroll: 62,
  NumLock: 63, Apps: 65, Multiply: 66, Add: 67, Subtract: 68, Decimal: 69, Divide: 70, NumpadEnter: 72,
  RShift: 73, RControl: 74, RAlt: 75, CtrlAltDel: 100, LockScreen: 101,
} as const;
