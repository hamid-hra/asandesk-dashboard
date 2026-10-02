"use client";

import { useEffect, useRef } from "react";

import { Icon } from "@/components/Icon";
import { ApiError, firstError } from "@/lib/api";

import s from "./settings.module.css";

export const I = {
  users: "M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.87M16 4.13a3.5 3.5 0 010 6.75",
  db: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  ha: "M3 5h8v6H3zM13 13h8v6h-8zM6 11v4h7M18 13V9h-7",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  key: "M15.5 3a5.5 5.5 0 00-5.2 7.3L3 17.6V21h3.4v-2h2v-2h2l1.3-1.3A5.5 5.5 0 1015.5 3zM17 7h.01",
  power: "M12 3v9M6.3 6.3a8 8 0 1011.4 0",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  restore: "M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  wrench: "M14.7 6.3a4 4 0 005 5L11 20l-4-1-1-4 8.7-8.7z",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z",
  copy: "M9 9h11v11H9zM5 15V4h11",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  refresh: "M20 12a8 8 0 11-2.3-5.7M20 4v5h-5",
  check: "M5 12l5 5 9-10",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 100-18 9 9 0 000 18z",
  clock: "M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
};

/** پیام خطای قابل‌نمایش از پاسخ API */
export const errText = (e: unknown, fallback = "عملیات انجام نشد.") =>
  e instanceof ApiError ? firstError(e.data) || (e.status === 403 ? "دسترسی کافی ندارید." : fallback) : fallback;

/** خطاهای هر فیلد از پاسخ 400 DRF */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || typeof e.data !== "object" || !e.data) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.data as Record<string, unknown>)) {
    const m = firstError(v);
    if (m) out[k] = m;
  }
  return out;
}

export function Modal({ title, onClose, children, footer, width = 560, busy }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,button.primary")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={s.dialog} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className={s.dlgHead}>
          <span>{title}</span>
          <button className={s.iconBtn} onClick={onClose} aria-label="بستن" disabled={busy}>
            <Icon d={I.close} size={16} />
          </button>
        </div>
        <div className={s.dlgBody}>{children}</div>
        {footer && <div className={s.dlgFoot}>{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, disabled, label, title }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled} className={s.switch} data-on={on} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Stepper({ value, min, max, onChange, disabled, unit }: { value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean; unit?: string }) {
  return (
    <div className={s.stepper} data-disabled={disabled}>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label="افزایش">
        +
      </button>
      <span dir="ltr" className="mono">
        {new Intl.NumberFormat("fa-IR").format(value)}
      </span>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="کاهش">
        −
      </button>
      {unit && <em>{unit}</em>}
    </div>
  );
}

export function Menu({ items, disabled, tip }: { items: { label: string; icon: string; onClick: () => void; danger?: boolean; disabled?: boolean; tip?: string }[]; disabled?: boolean; tip?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useOpen(ref);
  return (
    <div className={s.menuWrap} ref={ref}>
      <button className={s.iconBtn} onClick={() => setOpen(!open)} disabled={disabled} title={disabled ? tip : "عملیات"} aria-label="عملیات" aria-haspopup="menu" aria-expanded={open}>
        <Icon d={I.more} size={18} stroke={2.4} />
      </button>
      {open && (
        <div className={s.menu} role="menu">
          {items.map((m) => (
            <button
              key={m.label}
              role="menuitem"
              disabled={m.disabled}
              title={m.tip}
              data-danger={m.danger}
              onClick={() => {
                setOpen(false);
                m.onClick();
              }}
            >
              <Icon d={m.icon} size={15} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";

function useOpen(ref: React.RefObject<HTMLElement | null>): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, ref]);
  return [open, setOpen];
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={`card ${s.skeleton}`} aria-busy="true" aria-label="در حال بارگذاری">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={s.skRow}>
          <span className={s.skDot} />
          <span className={s.skLine} style={{ width: `${40 + ((i * 17) % 35)}%` }} />
          <span className={s.skLine} style={{ width: 60 }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={`card ${s.errorState}`}>
      <div className={s.emptyIcon} data-tone="danger">
        <Icon d={I.alert} size={22} />
      </div>
      <div className={s.emptyTitle}>بارگذاری انجام نشد</div>
      <div className={s.emptyText}>ارتباط با سرویس تنظیمات برقرار نشد. اتصال شبکه را بررسی کنید و دوباره تلاش کنید.</div>
      <button className={s.btnGhost} onClick={onRetry}>
        <Icon d={I.refresh} size={15} /> تلاش دوباره
      </button>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className={s.emptyState}>
      <div className={s.emptyIcon}>
        <Icon d={icon} size={22} />
      </div>
      <div className={s.emptyTitle}>{title}</div>
      <div className={s.emptyText}>{text}</div>
      {action}
    </div>
  );
}
