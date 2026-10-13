import { polar } from "@/lib/chart";
import { pctText } from "@/lib/fa";

import s from "./charts.module.css";

const START = 135;
const SWEEP = 270;
const TICKS = 54;
const CX = 150;

/** گیج با خط‌های ریز دور یک کمان: خط‌های روشن تا مقدار، و یک خط بلند سفید روی خود مقدار. */
export function TickGauge({ value, label, sub }: { value: number | null; label: string; sub?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const lit = Math.round((TICKS - 1) * (v / 100));
  const needle = START + SWEEP * (v / 100);
  return (
    <div className={s.gauge}>
      <svg viewBox="0 0 300 260" className={s.gaugeSvg} role="img" aria-label={`${label}: ${value == null ? "بدون داده" : pctText(v, 1)}`}>
        {Array.from({ length: TICKS }, (_, i) => {
          const a = START + (SWEEP * i) / (TICKS - 1);
          const [x1, y1] = polar(CX, CX - 10, 82, a);
          const [x2, y2] = polar(CX, CX - 10, 112, a);
          const on = value != null && i <= lit && v > 0;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? "var(--ok)" : "var(--track)"} strokeOpacity={on ? 0.35 + 0.65 * (i / Math.max(1, lit)) : 1} strokeWidth="5" strokeLinecap="round" />;
        })}
        {value != null && (
          <line
            x1={polar(CX, CX - 10, 72, needle)[0]}
            y1={polar(CX, CX - 10, 72, needle)[1]}
            x2={polar(CX, CX - 10, 120, needle)[0]}
            y2={polar(CX, CX - 10, 120, needle)[1]}
            stroke="var(--text)"
            strokeWidth="7"
            strokeLinecap="round"
          />
        )}
        <text x={CX} y={CX - 6} textAnchor="middle" className={s.gaugeBig}>
          {value == null ? "—" : pctText(v, v % 1 ? 1 : 0)}
        </text>
        <text x={CX} y={CX + 16} textAnchor="middle" className={s.radialCap}>
          {label}
        </text>
      </svg>
      {sub && <div className={s.gaugeSub}>{sub}</div>}
    </div>
  );
}
