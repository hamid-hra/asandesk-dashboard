"use client";

import { useState } from "react";

import { idxFrom, segments, smooth, tipBox } from "@/lib/chart";
import { toFa } from "@/lib/fa";
import type { Point, RangeId } from "@/lib/types";

import s from "./server.module.css";
import { METRICS, type MetricId, tipLabel, xLabels } from "./util";

const RH = 240;
const ry = (v: number) => RH - (v / 100) * (RH - 10);

export function ResourceChart({ points, range }: { points: Point[]; range: RangeId }) {
  const [selected, setSelected] = useState<MetricId[]>(["cpu", "ram", "net"]);
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500);
  const sel = METRICS.filter((m) => selected.includes(m.id));
  const ticks = [0, 1, 2, 3, 4].map((k) => {
    const y = 10 + (k / 4) * (RH - 10);
    return { y, top: `${(y / RH) * 100}%`, label: `${toFa((100 * (4 - k)) / 4)}٪` };
  });
  const toggle = (id: MetricId) =>
    setSelected((cur) => (cur.includes(id) ? (cur.length > 1 ? cur.filter((x) => x !== id) : cur) : [...cur, id]));
  const hasData = points.some((p) => p.cpu != null);
  const hp = hover != null ? points[hover] : null;

  return (
    <div className={`card ${s.chartCard}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>تاریخچه مصرف منابع</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>میانگین همه سرورها · درصد از ظرفیت</div>
        </div>
        <div style={{ flex: 1 }} />
        <div className={s.chips}>
          {METRICS.map((m) => {
            const on = selected.includes(m.id);
            return (
              <button key={m.id} aria-pressed={on} onClick={() => toggle(m.id)} style={on ? { borderColor: m.c } : undefined}>
                <span className="dot" style={{ background: on ? m.c : "var(--off)" }} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className={s.chartGrid}>
        <div
          dir="ltr"
          className={s.plot}
          style={{ height: RH }}
          onMouseMove={(e) => {
            const i = idxFrom(e, n);
            if (i !== hover) setHover(i);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 1000 ${RH}`} preserveAspectRatio="none">
            {ticks.map((t) => (
              <line key={t.y} x1="0" x2="1000" y1={t.y} y2={t.y} stroke="var(--grid)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2="1000" y1={ry(80)} y2={ry(80)} stroke="var(--danger)" strokeOpacity=".45" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            {sel.map((m) =>
              segments(points.map((p) => p[m.id]), x, ry)
                .filter((seg) => seg.length > 1)
                .map((seg, i) => (
                  <path key={`${m.id}-${i}`} d={smooth(seg)} fill="none" stroke={m.c} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
                )),
            )}
          </svg>
          {sel.map((m) =>
            segments(points.map((p) => p[m.id]), x, ry)
              .filter((seg) => seg.length === 1)
              .map((seg, i) => (
                <div
                  key={`${m.id}-dot-${i}`}
                  className={s.marker}
                  style={{ width: 7, height: 7, background: m.c, left: `${seg[0][0] / 10}%`, top: `${(seg[0][1] / RH) * 100}%` }}
                />
              )),
          )}
          <div dir="rtl" className={s.warnLabel} style={{ top: `${(ry(80) / RH) * 100}%` }}>
            آستانه هشدار ۸۰٪
          </div>
          {!hasData && <div className={s.noData}>هنوز داده‌ای در این بازه ثبت نشده</div>}
          {hp && hover != null && (
            <>
              <div className={s.cursor} style={{ left: tipBox(hover, n).left }} />
              {sel.map((m) => {
                const v = hp[m.id];
                return v == null ? null : (
                  <div
                    key={m.id}
                    className={s.marker}
                    style={{ width: 9, height: 9, border: `2px solid ${m.c}`, left: tipBox(hover, n).left, top: `${(ry(v) / RH) * 100}%` }}
                  />
                );
              })}
              <div dir="rtl" className={s.tip} style={{ ...tipBox(hover, n), minWidth: 150 }}>
                <div className={s.tipTitle}>{tipLabel(hp, range)}</div>
                {sel.map((m) => (
                  <div key={m.id} className={s.tipRow}>
                    <span className="dot" style={{ background: m.c }} />
                    <span>{m.label}</span>
                    <b>{hp[m.id] == null ? "—" : `${toFa(Math.round(hp[m.id]!))}٪`}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className={s.ticks} style={{ height: RH }}>
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
