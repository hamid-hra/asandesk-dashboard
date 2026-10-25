// اجزای مشترک رابط: پنجرهٔ گفت‌وگو، منو، پیام کوتاه، فیلد رمز و QR
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { Icon } from './icons';

export function Modal({ children, onClose, width }: { children: ReactNode; onClose?: () => void; width?: number }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" style={width ? { width } : undefined}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <h3>
      <span className="i">
        <Icon name={icon} size={20} />
      </span>
      {children}
    </h3>
  );
}

/** منوی شناور کنار یک دکمه؛ اگر جا نباشد به طرف دیگر می‌رود */
export function Menu({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 200;
    const rtl = document.documentElement.dir === 'rtl';
    let left = rtl ? r.left : r.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="menu" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }} onClick={onClose}>
      {children}
    </div>,
    document.body,
  );
}

let toastSetter: ((s: string | null) => void) | null = null;
let toastTimer = 0;

export function toast(text: string) {
  clearTimeout(toastTimer);
  toastSetter?.(text);
  toastTimer = window.setTimeout(() => toastSetter?.(null), 2400);
}

export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setText;
    return () => {
      toastSetter = null;
    };
  }, []);
  return text ? createPortal(<div className="toast">{text}</div>, document.body) : null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // روی http ساده clipboard API در دسترس نیست
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function PasswordInput({
  value, onChange, placeholder, autoComplete, autoFocus, bad, name, id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  bad?: boolean;
  name?: string;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input
        id={id}
        name={name}
        className={`input ltr${bad ? ' bad' : ''}`}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        dir="ltr"
        style={{ paddingLeft: 42, paddingRight: 42 }}
      />
      <button type="button" className="icon-btn eye" onClick={() => setShow(!show)} tabIndex={-1} aria-label={show ? 'hide' : 'show'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </div>
  );
}

export function QrCode({ text }: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <div className="qr">
      <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} shapeRendering="crispEdges">
        <path d={d} fill="#0f1f1e" />
      </svg>
    </div>
  );
}
