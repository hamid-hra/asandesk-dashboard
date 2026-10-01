"use client";

import { useState } from "react";

import { idxFrom, niceMax, segments, smooth, tipBox } from "@/lib/chart";
import { deltaText, fmt, toFa } from "@/lib/fa";
import type { Point, RangeId } from "@/lib/types";

import s from "./server.module.css";
import { firstLast, pctChange, tipLabel, xLabels } from "./util";

const H = 280;
const TOP = 30;

const tickLabel = (v: number) =>
  v >= 1000 ? toFa((v / 1000).toFixed(v % 1000 ? 1 : 0)) + "K" : toFa(Number.isInteger(v) ? v : v.toFixed(1));

export function ConnChart({ points, range, connNow }: { points: Point[]; range: RangeId; connNow: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const conn = points.map((p) => p.conn);
  const fail = points.map((p) => p.fail);
  const maxC = niceMax(Math.max(0, ...conn.filter((v): v is number => v != null)));
  const cy = (v: number) => H - (v / maxC) * (H - TOP);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500);

  const connSegs = segments(conn, x, cy);
  const failSegs = segments(fail, x, cy);
  const ticks = [0, 1, 2, 3, 4].map((k) => {
    const y = TOP + (k / 4) * (H - TOP);
    return { y, top: `${(y / H) * 100}%`, label: tickLabel((maxC * (4 - k)) / 4) };
  });

  const { first, last, count } = firstLast(conn);
  const cd = pctChange(last, first);
  const now = connNow ?? last;
  const hp = hover != null ? points[hover] : null;

  return (
    <div className={`card ${s.chartCard}`} style={{ flex: "1 1 520px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 14, color: "var(--muted)" }}>کانکشن‌های همزمان</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "4px 10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 30, fontWeight: 700 }}>{now == null ? "—" : fmt(now)}</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: cd == null ? "var(--faint)" : cd >= 0 ? "var(--accent)" : "var(--danger-text)",
              }}
            >
              {cd == null ? "داده کافی برای مقایسه نیست" : `${deltaText(cd)} نسبت به ابتدای بازه`}
            </span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className={s.legend}>
          <div>
            <span style={{ background: "var(--ok)" }} />
            موفق
          </div>
          <div title="پس از اتصال سرور آسان‌دسک">
            <span style={{ background: "var(--danger)" }} />
            ناموفق
          </div>
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
              <linearGradient id="gConn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#26a379" stopOpacity=".22" />
                <stop offset="1" stopColor="#26a379" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <line key={t.y} x1="0" x2="1000" y1={t.y} y2={t.y} stroke="var(--grid)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
            ))}
            {connSegs
              .filter((seg) => seg.length > 1)
              .map((seg, i) => {
                const line = smooth(seg);
                return (
                  <g key={i}>
                    <path d={`${line} L${seg[seg.length - 1][0]},${H} L${seg[0][0]},${H} Z`} fill="url(#gConn)" />
                    <path d={line} fill="none" stroke="var(--ok)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
            {failSegs
              .filter((seg) => seg.length > 1)
              .map((seg, i) => (
                <path key={i} d={smooth(seg)} fill="none" stroke="var(--danger)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
              ))}
          </svg>
          {connSegs
            .filter((seg) => seg.length === 1)
            .map((seg, i) => (
              <div
                key={i}
                className={s.marker}
                style={{ width: 7, height: 7, background: "var(--ok)", left: `${seg[0][0] / 10}%`, top: `${(seg[0][1] / H) * 100}%` }}
              />
            ))}
          {count === 0 && <div className={s.noData}>هنوز داده‌ای در این بازه ثبت نشده</div>}
          {hp && hover != null && (
            <>
              <div className={s.cursor} style={{ left: tipBox(hover, n).left }} />
              {hp.conn != null && (
                <div
                  className={s.marker}
                  style={{ width: 11, height: 11, border: "2.5px solid var(--ok)", left: tipBox(hover, n).left, top: `${(cy(hp.conn) / H) * 100}%` }}
                />
              )}
              {hp.fail != null && (
                <div
                  className={s.marker}
                  style={{ width: 9, height: 9, border: "2px solid var(--danger)", left: tipBox(hover, n).left, top: `${(cy(hp.fail) / H) * 100}%` }}
                />
              )}
              <div dir="rtl" className={s.tip} style={tipBox(hover, n)}>
                <div className={s.tipTitle}>{tipLabel(hp, range)}</div>
                <div className={s.tipRow}>
                  <span className="dot" style={{ background: "var(--ok)" }} />
                  <span>موفق</span>
                  <b>{hp.conn == null ? "—" : fmt(hp.conn)}</b>
                </div>
                <div className={s.tipRow}>
                  <span className="dot" style={{ background: "var(--danger)" }} />
                  <span>ناموفق</span>
                  <b>{hp.fail == null ? "—" : fmt(hp.fail)}</b>
                </div>
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
        {xLabels(points, range).map((l, i) => (
          <span key={i} dir="rtl">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
