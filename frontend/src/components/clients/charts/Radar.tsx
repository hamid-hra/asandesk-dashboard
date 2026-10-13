"use client";

import { useState } from "react";

import { polar, type Pt } from "@/lib/chart";
import { fmt, pctText } from "@/lib/fa";

import s from "./charts.module.css";

export interface RadarSeries {
  name: string;
  color: string;
  /** هر محور بین ۰ و ۱ */
  values: number[];
  /** عددهای واقعی برای راهنمای هر نقطه */
  raw: number[];
}

const CX = 170;
const CY = 150;
const R = 100;
const LABEL_R = 122;
const LEVELS = [0.25, 0.5, 0.75, 1];

/** رادار چندضلعی: هر محور یک شاخص و هر چندضلعی یک مجموعه (مثلاً یک پلتفرم). */
export function Radar({ axes, series, caption }: { axes: string[]; series: RadarSeries[]; caption: string }) {
  const [hot, setHot] = useState<string | null>(null);
  const n = axes.length;
  const angle = (i: number) => -90 + (i * 360) / n;
  const ring = (k: number) => axes.map((_, i) => polar(CX, CY, R * k, angle(i)));
  const poly = (pts: Pt[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <div className={s.radar}>
      <svg viewBox="0 0 340 300" className={s.radarSvg} role="img" aria-label={caption}>
        {LEVELS.map((k) => (
          <polygon key={k} points={poly(ring(k))} fill="none" stroke="var(--grid)" strokeWidth="1" />
        ))}
        {axes.map((_, i) => {
          const [x, y] = polar(CX, CY, R, angle(i));
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--grid)" strokeWidth="1" />;
        })}
        {series.map((sr) => {
          const pts = sr.values.map((v, i) => polar(CX, CY, R * Math.max(0.02, Math.min(1, v)), angle(i)));
          const dim = hot !== null && hot !== sr.name;
          return (
            <g key={sr.name} opacity={dim ? 0.2 : 1} style={{ transition: "opacity 0.15s" }} onMouseEnter={() => setHot(sr.name)} onMouseLeave={() => setHot(null)}>
              <polygon points={poly(pts)} fill={sr.color} fillOpacity="0.16" stroke={sr.color} strokeWidth="2" strokeLinejoin="round" />
              {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="4" fill="var(--surface)" stroke={sr.color} strokeWidth="2">
                  <title>{`${sr.name} · ${axes[i]}: ${fmt(sr.raw[i])} (${pctText(sr.values[i] * 100)})`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {axes.map((label, i) => {
          const [x, y] = polar(CX, CY, LABEL_R, angle(i));
          const anchor = Math.abs(x - CX) < 8 ? "middle" : x > CX ? "start" : "end";
          return (
            <text key={label} x={x} y={y + 4} textAnchor={anchor} className={s.radarLabel}>
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
