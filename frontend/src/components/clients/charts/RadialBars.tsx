"use client";

import { useState } from "react";

import { arcPath } from "@/lib/chart";
import { fmt, pctText } from "@/lib/fa";

import s from "./charts.module.css";

export interface RadialItem {
  label: string;
  value: number;
  color: string;
  /** برچسب لاتین (شمارهٔ نسخه) چپ‌به‌راست نوشته می‌شود */
  latin?: boolean;
  /** نشان کوچک کنار نام، مثل «آخرین» */
  badge?: string;
  /** تقسیم این مقدار بین بخش‌ها، مثل ویندوز و لینوکس، برای نوار کوچک کنار ردیف */
  parts?: { label: string; value: number; color: string }[];
}

const START = 135; // پایین-چپ
const SWEEP = 270;
const CX = 140;
const R0 = 120;
const GAP = 17;
const WIDTH = 11;

/** کمان‌های هم‌مرکز: هر حلقه یک مورد؛ طول کمان نسبت به بزرگ‌ترین مورد است. فهرست کنارش عدد و درصد دقیق را می‌دهد. */
export function RadialBars({ items, caption, centerLabel }: { items: RadialItem[]; caption: string; centerLabel: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const total = items.reduce((n, i) => n + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className={s.radial}>
      <svg viewBox="0 0 280 280" className={s.radialSvg} role="img" aria-label={caption}>
        {items.map((it, i) => {
          const r = R0 - i * GAP;
          const end = START + SWEEP * Math.max(0.025, (it.value / max) * 0.92);
          const dim = hot !== null && hot !== i;
          return (
            <g key={it.label} opacity={dim ? 0.3 : 1} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} style={{ transition: "opacity 0.15s" }}>
              <path d={arcPath(CX, CX, r, START, START + SWEEP)} fill="none" stroke="var(--track)" strokeWidth={WIDTH} strokeLinecap="round" />
              <path d={arcPath(CX, CX, r, START, end)} fill="none" stroke={it.color} strokeWidth={WIDTH} strokeLinecap="round">
                <title>{`${it.label}: ${fmt(it.value)}`}</title>
              </path>
            </g>
          );
        })}
        <text x={CX} y={CX - 2} textAnchor="middle" className={s.radialBig}>
          {fmt(hot !== null ? items[hot].value : total)}
        </text>
        <text x={CX} y={CX + 20} textAnchor="middle" className={s.radialCap}>
          {hot !== null ? items[hot].label : centerLabel}
        </text>
      </svg>
      <ul className={s.radialLegend}>
        {items.map((it, i) => (
          <li key={it.label} data-dim={hot !== null && hot !== i} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}>
            <span className="dot" style={{ background: it.color }} />
            <span className={s.lgLabel} dir={it.latin ? "ltr" : undefined} data-latin={it.latin}>
              {it.label}
            </span>
            {it.badge && <em className={s.lgBadge}>{it.badge}</em>}
            {it.parts && it.value > 0 && (
              <span className={s.stack} aria-hidden="true">
                {it.parts
                  .filter((p) => p.value > 0)
                  .map((p) => (
                    <i key={p.label} style={{ flex: p.value, background: p.color }} title={`${p.label}: ${fmt(p.value)}`} />
                  ))}
              </span>
            )}
            <span className={s.lgPct}>{total ? pctText((it.value / total) * 100) : "—"}</span>
            <b className={s.lgNum}>{fmt(it.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
