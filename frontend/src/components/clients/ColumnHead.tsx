"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { toFa } from "@/lib/fa";

import s from "./clients.module.css";
import type { SortDir } from "./query";

/**
 * Header of a table column. Clicking it opens a menu with that column's sort and filter choices
 * (like the column menus of a spreadsheet). The menu lives in <body> with a fixed position, so the
 * scrolling table can not clip it; it sits under the header (right edges together, as the page is RTL).
 */
export function ColumnHead({ label, sort, filtered, children }: { label: string; sort?: SortDir | null; filtered?: boolean; children: React.ReactNode }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const btn = button.current;
    const box = panel.current;
    if (!open || !btn || !box) return;
    const r = btn.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const pad = 8;
    let left = r.right - w;
    if (left < pad) left = r.left;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    // under the header if it fits, else above it; if it fits on neither side it takes the roomier side and scrolls
    const gap = 6;
    const below = window.innerHeight - r.bottom - gap - pad;
    const above = r.top - gap - pad;
    let top = r.bottom + gap;
    if (h > below) {
      if (h <= above) top = r.top - gap - h;
      else if (below >= above) box.style.maxHeight = `${below}px`;
      else {
        box.style.maxHeight = `${above}px`;
        top = r.top - gap - above;
      }
    }
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.visibility = "visible";
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    // a scroll inside the menu itself (a long list) must not close it
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={s.colHead}
        data-on={!!sort || !!filtered}
        aria-haspopup="menu"
        aria-expanded={open}
        title="فیلتر و مرتب‌سازی"
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        {sort && (
          <svg className={s.colSort} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label={sort === "asc" ? "صعودی" : "نزولی"}>
            <path d={sort === "asc" ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} />
          </svg>
        )}
        {filtered && <span className={s.colDot} aria-label="فیلتر روشن" />}
        <svg className={s.colChevron} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className={s.colMenu} ref={panel} role="menu" aria-label={label} style={{ visibility: "hidden", top: 0, left: 0 }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuSection({ title, children, scroll }: { title: string; children: React.ReactNode; scroll?: boolean }) {
  return (
    <div className={s.cmSection}>
      <div className={s.cmTitle}>{title}</div>
      <div className={scroll ? s.cmScroll : undefined}>{children}</div>
    </div>
  );
}

/** یک گزینهٔ منو: «radio» برای انتخاب یکی از چند گزینه، «check» برای کلید روشن/خاموش */
export function Choice({ on, onClick, kind = "radio", count, children }: { on: boolean; onClick: () => void; kind?: "radio" | "check"; count?: number; children: React.ReactNode }) {
  return (
    <button type="button" role={kind === "radio" ? "menuitemradio" : "menuitemcheckbox"} aria-checked={on} className={s.cmChoice} data-kind={kind} onClick={onClick}>
      <span className={s.cmMark} aria-hidden="true">
        {on && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
      <span className={s.cmLabel}>{children}</span>
      {count != null && <em>{toFa(count)}</em>}
    </button>
  );
}
