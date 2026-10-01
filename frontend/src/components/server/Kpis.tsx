import { deltaText, fmt, pctText } from "@/lib/fa";
import type { Overview } from "@/lib/types";

import s from "./server.module.css";
import { firstLast, pctChange } from "./util";

interface Kpi {
  label: string;
  value: string;
  unit: string;
  delta: number | null;
  goodUp: boolean;
  series: (number | null)[];
}

function bars(series: (number | null)[], good: string) {
  const n = series.length;
  const step = Math.max(1, Math.floor(n / 10));
  const arr: (number | null)[] = [];
  for (let i = n - 10 * step; i < n; i += step) arr.push(series[Math.max(0, i)] ?? null);
  const xs = arr.filter((v): v is number => v != null);
  const mx = Math.max(...xs, 0);
  const mn = Math.min(...xs, mx);
  return arr.map((v, i) => ({
    h: v == null ? 6 : 6 + ((v - mn) / (mx - mn || 1)) * 20,
    c: i === arr.length - 1 && v != null ? good : "var(--bar-off)",
  }));
}

export function Kpis({ data, connNow }: { data: Overview | undefined; connNow: number | null }) {
  const pts = data?.points ?? [];
  const conn = pts.map((p) => p.conn);
  const connMax = pts.map((p) => p.conn_max);
  const half = Math.floor(pts.length / 2);
  const { first, last } = firstLast(conn);
  const peak = Math.max(...connMax.filter((v): v is number => v != null), -1);
  const peakFirstHalf = Math.max(...connMax.slice(0, half).filter((v): v is number => v != null), -1);
  const current = connNow ?? last;

  const kpis: Kpi[] = [
    {
      label: "کانکشن‌های فعال",
      value: current == null ? "—" : fmt(current),
      unit: "اتصال",
      delta: pctChange(last, first),
      goodUp: true,
      series: conn,
    },
    {
      label: "اوج همزمان",
      value: peak < 0 ? "—" : fmt(peak),
      unit: "اتصال",
      delta: peakFirstHalf < 0 ? null : pctChange(peak, peakFirstHalf),
      goodUp: true,
      series: connMax,
    },
    {
      label: "کل نشست‌ها",
      value: data?.sessions_total == null ? "—" : fmt(data.sessions_total),
      unit: "نشست",
      delta: null,
      goodUp: true,
      series: [],
    },
    {
      label: "نرخ اتصال ناموفق",
      value: data?.fail_rate == null ? "—" : pctText(data.fail_rate, 2),
      unit: "",
      delta: null,
      goodUp: false,
      series: pts.map((p) => p.fail),
    },
  ];

  return (
    <div className={s.kpis}>
      {kpis.map((k) => {
        const good = k.delta == null || (k.delta >= 0) === k.goodUp;
        return (
          <div key={k.label} className={s.kpi}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div className={s.kpiLabel}>{k.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className={s.kpiValue}>{k.value}</span>
                {k.value !== "—" && <span className={s.kpiUnit}>{k.unit}</span>}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <div className={s.kpiDelta} style={{ color: good ? "var(--accent)" : "var(--danger-text)" }}>
                {k.delta != null ? (
                  <>
                    <span>{k.delta >= 0 ? "↑" : "↓"}</span>
                    <span>{deltaText(k.delta)}</span>
                  </>
                ) : k.value === "—" ? (
                  <span style={{ color: "var(--faint)", fontWeight: 500 }}>بدون داده</span>
                ) : null}
              </div>
              <div dir="ltr" className={s.spark}>
                {bars(k.series.length ? k.series : Array(10).fill(null), good ? "var(--ok)" : "var(--danger)").map((b, i) => (
                  <span key={i} style={{ height: b.h, background: b.c }} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
