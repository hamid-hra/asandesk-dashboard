"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import s from "./Tip.module.css";

type Side = "left" | "right" | "top" | "bottom";

/**
 * Tooltip («متن راهنما») that lives in <body>, so a scrolling sidebar or a card can not clip it.
 * Shows on hover and on keyboard focus; `content` can be text or a small panel (the status popover).
 */
export function Tip({
  content,
  side = "top",
  disabled,
  children,
  interactive,
  block,
  className,
}: {
  content: React.ReactNode;
  side?: Side;
  disabled?: boolean;
  children: React.ReactNode;
  /** the pointer may move onto the bubble (for a panel with links) */
  interactive?: boolean;
  block?: boolean;
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hide.current) clearTimeout(hide.current);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => setOpen(false), interactive ? 120 : 0);
  }, [interactive]);

  useLayoutEffect(() => {
    const a = anchor.current;
    const b = bubble.current;
    if (!open || !a || !b) return;
    const r = a.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const gap = 10;
    const pad = 8;
    let place = side;
    // جا نیست؟ طرف مقابل
    if (place === "left" && r.left - w - gap < pad) place = "right";
    else if (place === "right" && r.right + w + gap > window.innerWidth - pad) place = "left";
    else if (place === "top" && r.top - h - gap < pad) place = "bottom";
    else if (place === "bottom" && r.bottom + h + gap > window.innerHeight - pad) place = "top";
    let left = 0;
    let top = 0;
    if (place === "left" || place === "right") {
      left = place === "left" ? r.left - w - gap : r.right + gap;
      top = r.top + r.height / 2 - h / 2;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = place === "top" ? r.top - h - gap : r.bottom + gap;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.dataset.side = place;
    b.style.visibility = "visible";
  }, [open, side, content]);

  useEffect(() => {
    if (!open) return;
    const off = () => setOpen(false);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [open]);

  useEffect(() => () => {
    if (hide.current) clearTimeout(hide.current);
  }, []);

  return (
    <span
      ref={anchor}
      className={`${block ? s.block : s.anchor} ${className ?? ""}`}
      onMouseEnter={disabled ? undefined : show}
      onMouseLeave={disabled ? undefined : close}
      onFocus={disabled ? undefined : show}
      onBlur={disabled ? undefined : close}
    >
      {children}
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            className={`${s.bubble} ${typeof content === "string" ? s.text : s.panel}`}
            style={{ visibility: "hidden", top: 0, left: 0, pointerEvents: interactive ? "auto" : "none" }}
            onMouseEnter={interactive ? show : undefined}
            onMouseLeave={interactive ? close : undefined}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** «ⓘ» کوچک کنار عنوان یا برچسب؛ توضیح فقط با بردن نشانگر روی آن (یا فوکوس) دیده می‌شود */
export function InfoTip({ text, side = "top" }: { text: React.ReactNode; side?: Side }) {
  return (
    <Tip content={text} side={side}>
      <button type="button" className={s.info} aria-label={typeof text === "string" ? text : "راهنما"} tabIndex={0} onClick={(e) => e.preventDefault()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 8h.01M11 12h1v5h1M12 21a9 9 0 100-18 9 9 0 000 18z" />
        </svg>
      </button>
    </Tip>
  );
}
