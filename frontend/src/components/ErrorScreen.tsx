"use client";

import Link from "next/link";
import { useState } from "react";

import s from "./ErrorScreen.module.css";

export interface ErrorAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

const BODY = (
  <>
    <rect className={s.bg} width="24" height="24" rx="6" />
    <path className={s.st} d="M4.6 12.2 11.4 5.6 16 10.2" />
    <path className={s.st} d="M8 13.8 12 17.8 19.6 10.2" />
  </>
);

/** The AsanDesk mark that splits in two; a click plays the animation again. */
function SplitLogo() {
  const [round, setRound] = useState(0);
  return (
    <button type="button" className={s.logoBtn} aria-label="پخش دوبارهٔ انیمیشن" title="پخش دوبارهٔ انیمیشن" onClick={() => setRound((n) => n + 1)}>
      <svg key={round} viewBox="-6 -6 36 42" width="176" height="206" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
        <ellipse className={s.shadow} cx="12" cy="29" rx="9" ry="1.1" />
        <g className={s.shake}>
          <g className={s.floatL}>
            <g className={s.splitL}>
              <clipPath id="adL">
                <polygon points="0,0 13,0 10.6,6 14,10 11,15 13.6,19 12,24 0,24" />
              </clipPath>
              <g clipPath="url(#adL)">{BODY}</g>
            </g>
          </g>
          <g className={s.floatR}>
            <g className={s.splitR}>
              <clipPath id="adR">
                <polygon points="24,0 24,24 12,24 13.6,19 11,15 14,10 10.6,6 13,0" />
              </clipPath>
              <g clipPath="url(#adR)">{BODY}</g>
            </g>
          </g>
          <g>
            <path className={`${s.frag} ${s.bg}`} d="M11.6 7.6 13.2 9.4 11.2 10Z" style={{ ["--dx" as string]: "-3px", ["--rot" as string]: "-140deg", animationDelay: "1.5s" }} />
            <path className={`${s.frag} ${s.bg}`} d="M12.4 13 13.9 14.4 12.3 15.4Z" style={{ ["--dx" as string]: "3px", ["--rot" as string]: "120deg", animationDelay: "2.3s" }} />
            <path className={s.frag} fill="var(--muted)" d="M11.9 17.2 13 18.6 11.6 19.2Z" style={{ ["--dx" as string]: "-1.5px", ["--rot" as string]: "200deg", animationDelay: "3.1s" }} />
            <path className={s.frag} fill="var(--muted)" d="M12.8 4.2 13.6 5.4 12.4 5.6Z" style={{ ["--dx" as string]: "2px", ["--rot" as string]: "-90deg", animationDelay: "3.8s" }} />
          </g>
        </g>
      </svg>
    </button>
  );
}

function Action({ a, primary }: { a: ErrorAction; primary?: boolean }) {
  const cls = `${s.btn} ${primary ? s.primary : ""}`;
  if (a.href) {
    return (
      <Link href={a.href} className={cls}>
        {a.label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={a.onClick}>
      {a.label}
    </button>
  );
}

/** Error page of the panel, same design as the nginx error pages. */
export function ErrorScreen({ code, title, message, hint, primary, secondary }: { code: string; title: string; message: string; hint: string; primary: ErrorAction; secondary: ErrorAction }) {
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <SplitLogo />
        <div className={s.info}>
          <div className={s.pill}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.8v5M12 16.2h.01" />
            </svg>
            <span>کد خطا</span>
            <b dir="ltr">{code}</b>
          </div>
          <h1 className={s.title}>{title}</h1>
          <p className={s.msg}>{message}</p>
          <div className={s.hint}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 11v5M12 7.8h.01" />
            </svg>
            <span>{hint}</span>
          </div>
        </div>
        <div className={s.acts}>
          <Action a={primary} primary />
          <Action a={secondary} />
        </div>
      </div>
    </div>
  );
}
