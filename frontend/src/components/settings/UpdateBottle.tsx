"use client";

import { useId } from "react";

import { LOGO_MARK } from "@/components/Logo";

import s from "./UpdateBottle.module.css";

// موج: دو طول موج (هر کدام ۵۰۰ واحد) تا با جابه‌جایی ۵۰۰ واحدی بی‌درز تکرار شود
const WAVE = "M-1000 0 Q-875 -34 -750 0 T-500 0 T-250 0 T0 0 T250 0 T500 0 T750 0 T1000 0 T1250 0 T1500 0 V1300 H-1000 Z";
const BUBBLES = [
  { x: 240, r: 14, dur: 3.2, delay: 0 },
  { x: 380, r: 9, dur: 2.6, delay: 0.9 },
  { x: 520, r: 16, dur: 3.8, delay: 0.4 },
  { x: 640, r: 8, dur: 2.2, delay: 1.6 },
  { x: 760, r: 12, dur: 3.0, delay: 2.1 },
  { x: 330, r: 7, dur: 2.4, delay: 2.6 },
  { x: 700, r: 10, dur: 3.4, delay: 1.2 },
];

/**
 * نشان آسان‌دسک مثل یک بطری که از پایین سبز می‌شود: سطح مایع موج دارد و حباب‌ها (مثل نوشابه) بالا می‌روند.
 * `pct` از ۰ تا ۱۰۰؛ با ۱۰۰ دقیقاً خود لوگو می‌شود. `tone="failed"` مایع را قرمز می‌کند.
 */
export function UpdateBottle({ pct, tone = "running", size = 168 }: { pct: number; tone?: "running" | "ok" | "failed"; size?: number }) {
  const id = useId().replace(/:/g, "");
  const p = Math.max(0, Math.min(100, pct));
  // در ۱۰۰٪ قلهٔ موج هم باید بالای لبه باشد
  const level = 1000 - (p / 100) * 1080;
  const still = tone !== "running";

  const wave = (speed: number, from: number) => (
    <path d={WAVE}>
      {!still && <animateTransform attributeName="transform" type="translate" from={`${from} 0`} to={`${from - 500} 0`} dur={`${speed}s`} repeatCount="indefinite" />}
    </path>
  );

  return (
    <div className={s.wrap} data-tone={tone} style={{ width: size, height: size }} role="img" aria-label={`پیشرفت به‌روزرسانی: ${Math.round(p)}٪`}>
      <svg viewBox="-20 -20 1040 1040" className={s.svg}>
        <defs>
          <clipPath id={`${id}-bottle`}>
            <rect width="1000" height="1000" rx="220" />
          </clipPath>
          <linearGradient id={`${id}-liquid`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={s.liquidTop} />
            <stop offset="1" className={s.liquidBottom} />
          </linearGradient>
          <mask id={`${id}-mask`}>
            <g className={s.level} style={{ transform: `translateY(${level}px)` }} fill="#fff">
              {wave(2.4, 0)}
            </g>
          </mask>
        </defs>

        {/* بطری خالی */}
        <rect width="1000" height="1000" rx="220" className={s.glass} />
        {LOGO_MARK.map((pts) => (
          <polygon key={`e-${pts}`} points={pts} className={s.markEmpty} />
        ))}

        <g clipPath={`url(#${id}-bottle)`}>
          {/* موج پشتی روشن‌تر و کندتر */}
          <g className={s.level} style={{ transform: `translateY(${level - 18}px)` }}>
            <g className={s.backWave}>{wave(3.6, 250)}</g>
          </g>
          {/* مایع اصلی */}
          <g className={s.level} style={{ transform: `translateY(${level}px)` }} fill={`url(#${id}-liquid)`}>
            {wave(2.4, 0)}
          </g>
          {/* حباب‌ها فقط داخل مایع دیده می‌شوند */}
          {!still && (
            <g mask={`url(#${id}-mask)`} className={s.bubbles}>
              {BUBBLES.map((b, i) => (
                <circle key={i} cx={b.x} cy={1060} r={b.r}>
                  <animate attributeName="cy" from="1060" to="80" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                  <animate attributeName="cx" values={`${b.x};${b.x + 18};${b.x - 12};${b.x}`} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                </circle>
              ))}
            </g>
          )}
          {/* شورون‌های سفید لوگو، فقط جایی که مایع رسیده */}
          <g mask={`url(#${id}-mask)`}>
            {LOGO_MARK.map((pts) => (
              <polygon key={`f-${pts}`} points={pts} fill="#fff" />
            ))}
          </g>
        </g>

        {/* لبهٔ بطری */}
        <rect width="1000" height="1000" rx="220" className={s.rim} />
      </svg>
      {tone === "ok" && (
        <span className={s.badge} data-tone="ok" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
      )}
      {tone === "failed" && (
        <span className={s.badge} data-tone="failed" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </span>
      )}
    </div>
  );
}
