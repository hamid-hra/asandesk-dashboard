// صفحه‌کلید مرورگر → KeyEvent حالت Legacy (src/server/input_service.rs، legacy_keyboard_mode)
//
// * کلیدهای ویژه (Enter، جهت‌ها، F1 و …) → control_key با down/up
// * نویسهٔ معمولی بدون Ctrl/Alt/Win → seq (همان متن، با هر زبانی تایپ می‌شود)
// * میان‌بر (Ctrl+C و …) → chr = حرف لاتین همان کلید فیزیکی، با modifiers
import { ControlKey, KeyboardMode, type Msg } from './proto';

const CODE_TO_CONTROL: Record<string, number> = {
  Backspace: ControlKey.Backspace, Tab: ControlKey.Tab, Enter: ControlKey.Return, Escape: ControlKey.Escape,
  Space: ControlKey.Space, Delete: ControlKey.Delete, Insert: ControlKey.Insert, Home: ControlKey.Home,
  End: ControlKey.End, PageUp: ControlKey.PageUp, PageDown: ControlKey.PageDown,
  ArrowLeft: ControlKey.LeftArrow, ArrowRight: ControlKey.RightArrow, ArrowUp: ControlKey.UpArrow,
  ArrowDown: ControlKey.DownArrow, CapsLock: ControlKey.CapsLock, NumLock: ControlKey.NumLock,
  ScrollLock: ControlKey.Scroll, Pause: ControlKey.Pause, ContextMenu: ControlKey.Apps,
  F1: ControlKey.F1, F2: ControlKey.F2, F3: ControlKey.F3, F4: ControlKey.F4, F5: ControlKey.F5,
  F6: ControlKey.F6, F7: ControlKey.F7, F8: ControlKey.F8, F9: ControlKey.F9, F10: ControlKey.F10,
  F11: ControlKey.F11, F12: ControlKey.F12,
  NumpadEnter: ControlKey.NumpadEnter, NumpadMultiply: ControlKey.Multiply, NumpadAdd: ControlKey.Add,
  NumpadSubtract: ControlKey.Subtract, NumpadDivide: ControlKey.Divide, NumpadDecimal: ControlKey.Decimal,
  Numpad0: ControlKey.Numpad0, Numpad1: ControlKey.Numpad1, Numpad2: ControlKey.Numpad2,
  Numpad3: ControlKey.Numpad3, Numpad4: ControlKey.Numpad4, Numpad5: ControlKey.Numpad5,
  Numpad6: ControlKey.Numpad6, Numpad7: ControlKey.Numpad7, Numpad8: ControlKey.Numpad8,
  Numpad9: ControlKey.Numpad9,
};

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
]);

// کلید فیزیکی → نویسهٔ لاتین (چیدمان US)، برای میان‌برها روی هر چیدمانی (مثلا فارسی)
const PUNCT: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
};

function latinOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return PUNCT[code] ?? null;
}

export function modifiersOf(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): number[] {
  const m: number[] = [];
  if (e.ctrlKey) m.push(ControlKey.Control);
  if (e.altKey) m.push(ControlKey.Alt);
  if (e.shiftKey) m.push(ControlKey.Shift);
  if (e.metaKey) m.push(ControlKey.Meta);
  return m;
}

/** پیام‌های key_event برای یک رویداد keydown/keyup. فهرست خالی = چیزی فرستاده نمی‌شود. */
export function keyEventsFor(e: KeyboardEvent, down: boolean): Msg[] {
  if (MODIFIER_CODES.has(e.code)) return [];
  const altGr = e.getModifierState?.('AltGraph') ?? false;
  const hotkey = (e.ctrlKey || e.altKey || e.metaKey) && !altGr;
  const modifiers = modifiersOf(e);
  const control = CODE_TO_CONTROL[e.code];
  // Numpad با NumLock روشن عدد تایپ می‌کند، نه کلید جهت
  const numpadDigit = /^Numpad\d$|^NumpadDecimal$/.test(e.code) && e.key.length === 1 && !hotkey;
  if (control !== undefined && !numpadDigit && !(e.code === 'Space' && !hotkey)) {
    return [{ key_event: { control_key: control, down, press: false, modifiers, mode: KeyboardMode.Legacy } }];
  }
  if (hotkey) {
    const latin = latinOf(e.code) ?? (e.key.length === 1 ? e.key.toLowerCase() : null);
    if (!latin) return [];
    return [{ key_event: { chr: latin.codePointAt(0), down, press: false, modifiers, mode: KeyboardMode.Legacy } }];
  }
  if (!down) return [];
  if (e.key.length >= 1 && [...e.key].length === 1) {
    return [{ key_event: { seq: e.key, down: true, press: false, mode: KeyboardMode.Legacy } }];
  }
  return [];
}

export function ctrlAltDel(peerPlatform: string): Msg {
  if (peerPlatform === 'Windows') {
    return { key_event: { control_key: ControlKey.CtrlAltDel, down: true, press: false, mode: KeyboardMode.Legacy } };
  }
  return {
    key_event: {
      control_key: ControlKey.Delete, down: true, press: true,
      modifiers: [ControlKey.Control, ControlKey.Alt], mode: KeyboardMode.Legacy,
    },
  };
}

export function lockScreen(): Msg {
  return { key_event: { control_key: ControlKey.LockScreen, down: true, press: false, mode: KeyboardMode.Legacy } };
}

/** متن (مثلا از «چسباندن») یک‌جا تایپ می‌شود */
export function typeText(text: string): Msg {
  return { key_event: { seq: text, down: true, press: false, mode: KeyboardMode.Legacy } };
}
