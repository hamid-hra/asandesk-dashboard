import { dfDay, dfFull, toFa } from "@/lib/fa";
import type { Point, RangeId } from "@/lib/types";

export const RANGES: { id: RangeId; label: string }[] = [
  { id: "24h", label: "۲۴ ساعت" },
  { id: "7d", label: "۷ روز" },
  { id: "30d", label: "۳۰ روز" },
  { id: "90d", label: "۹۰ روز" },
];

export const METRICS = [
  { id: "cpu", label: "پردازنده", c: "var(--m-cpu)" },
  { id: "ram", label: "حافظه", c: "var(--m-ram)" },
  { id: "disk", label: "دیسک", c: "var(--m-disk)" },
  { id: "net", label: "پهنای باند", c: "var(--m-net)" },
] as const;

export type MetricId = (typeof METRICS)[number]["id"];

/** رنگ نوار مصرف: سبز / زرد بالای ۶۵٪ / قرمز بالای ۸۰٪ */
export const lvl = (v: number) => (v >= 80 ? "var(--danger)" : v >= 65 ? "var(--warn)" : "var(--ok)");

const hh = (d: Date) => `${toFa(String(d.getHours()).padStart(2, "0"))}:۰۰`;

export function tipLabel(p: Point, range: RangeId) {
  const t = new Date(p.t);
  return range === "24h" || range === "7d" ? `${dfDay.format(t)} · ${hh(t)}` : dfFull.format(t);
}

export function xLabels(points: Point[], range: RangeId): string[] {
  const n = points.length;
  if (!n) return [];
  return [0, 1, 2, 3, 4, 5].map((k) => {
    const t = new Date(points[Math.round((k / 5) * (n - 1))].t);
    return range === "24h" ? hh(t) : dfDay.format(t);
  });
}

export const firstLast = (vals: (number | null)[]) => {
  const xs = vals.filter((v): v is number => v != null);
  // با کمتر از دو نقطه مقایسه‌ای معنا ندارد
  return { first: xs.length > 1 ? xs[0] : undefined, last: xs[xs.length - 1], count: xs.length };
};

/** درصد تغییر؛ اگر پایه صفر یا داده ناکافی باشد null */
export const pctChange = (a: number | undefined, b: number | undefined) =>
  a == null || b == null || b === 0 ? null : ((a - b) / b) * 100;
