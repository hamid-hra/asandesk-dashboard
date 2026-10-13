"use client";

import { useState } from "react";

import { idxFrom, niceMax, platformColor, smooth, tipBox } from "@/lib/chart";
import { dfDay, fmt, toFa } from "@/lib/fa";
import type { ChartDay } from "@/lib/types";

import s from "./charts.module.css";

const H = 250;
const TOP = 22;

type Mode = "total" | "new";

const tickLabel = (v: number) => (v >= 1000 ? toFa((v / 1000).toFixed(v % 1000 ? 1 : 0)) + "K" : toFa(Number.isInteger(v) ? v : v.toFixed(1)));
const dayText = (iso: string) => dfDay.format(new Date(`${iso}T12:00:00`));

/** نصب‌ها در ۹۰ روز اخیر: «مجموع نصب‌ها» (سطح) یا «نصب جدید روزانه» (ستون‌های جدا برای هر پلتفرم). */
export function InstallsChart({ daily, platforms }: { daily: ChartDay[]; platforms: string[] }) {
  const [mode, setMode] = useState<Mode>("total");
  const [hover, setHover] = useState<number | null>(null);
  const n = daily.length;
  const values = daily.map((d) => (mode === "total" ? d.total : d.new));
  const maxV = niceMax(Math.max(0, ...values), 4);
  const y = (v: number) => H - (v / maxV) * (H - TOP);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500);
  const empty = daily.every((d) => d.total === 0);

  const ticks = [0, 1, 2, 3, 4].map((k) => {
    const yy = TOP + (k / 4) * (H - TOP);
    return { y: yy, top: `${(yy / H) * 100}%`, label: tickLabel((maxV * (4 - k)) / 4) };
  });
  const labelAt = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
  const barW = (1000 / Math.max(1, n)) * 0.66;
  const hd = hover != null ? daily[hover] : null;

  return (
    <div className={s.trend}>
      <div className={s.trendTop}>
        <div className="seg" role="group" aria-label="نوع نمودار">
          <button aria-pressed={mode === "total"} onClick={() => setMode("total")}>مجموع نصب‌ها</button>
          <button aria-pressed={mode === "new"} onClick={() => setMode("new")}>نصب جدید روزانه</button>
        </div>
        <div className={s.dotLegend}>
          {platforms.map((p) => (
            <span key={p}>
              <i style={{ background: platformColor(p) }} />
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className={s.chartGrid}>
        <div
          dir="ltr"
          className={s.plot}
          style={{ height: H }}
          onMouseMove={(e) => {
            const i = idxFrom(e, n);
            if (i !== hover) setHover(i);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="gInstalls" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#26a379" stopOpacity=".25" />
                <stop offset="1" stopColor="#26a379" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <line key={t.y} x1="0" x2="1000" y1={t.y} y2={t.y} stroke="var(--grid)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
            ))}
            {mode === "total" && n > 1 && (
              <>
                <path d={`${smooth(values.map((v, i) => [x(i), y(v)]))} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill="url(#gInstalls)" />
                <path d={smooth(values.map((v, i) => [x(i), y(v)]))} fill="none" stroke="var(--ok)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
              </>
            )}
            {mode === "new" &&
              daily.map((d, i) => {
                let base = H;
                return platforms.map((p) => {
                  const v = d.platforms[p] ?? 0;
                  if (!v) return null;
                  const h = (v / maxV) * (H - TOP);
                  base -= h;
                  return <rect key={`${i}-${p}`} x={x(i) - barW / 2} y={base} width={barW} height={h} fill={platformColor(p)} opacity={hover === i || hover === null ? 1 : 0.55} rx="2" />;
                });
              })}
          </svg>
          {empty && <div className={s.noData}>هنوز نصبی ثبت نشده</div>}
          {hd && hover != null && (
            <>
              <div className={s.cursor} style={{ left: tipBox(hover, n).left }} />
              {mode === "total" && <div className={s.marker} style={{ left: tipBox(hover, n).left, top: `${(y(hd.total) / H) * 100}%`, width: 11, height: 11, border: "2.5px solid var(--ok)" }} />}
              <div dir="rtl" className={s.tip} style={tipBox(hover, n)}>
                <div className={s.tipTitle}>{dayText(hd.date)}</div>
                <div className={s.tipRow}>
                  <span>مجموع نصب‌ها</span>
                  <b>{fmt(hd.total)}</b>
                </div>
                <div className={s.tipRow}>
                  <span>نصب جدید این روز</span>
                  <b>{fmt(hd.new)}</b>
                </div>
                {platforms
                  .filter((p) => hd.platforms[p])
                  .map((p) => (
                    <div key={p} className={s.tipRow}>
                      <span className="dot" style={{ background: platformColor(p) }} />
                      <span>{p}</span>
                      <b>{fmt(hd.platforms[p])}</b>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
        <div className={s.ticks} style={{ height: H }}>
          {ticks.map((t) => (
            <span key={t.y} style={{ top: t.top }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <div dir="ltr" className={s.xLabels}>
        {labelAt.map((i, k) => (
          <span key={k} dir="rtl">
            {daily[i] ? dayText(daily[i].date) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
