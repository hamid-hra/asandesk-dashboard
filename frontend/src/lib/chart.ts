import type { MouseEvent } from "react";

export type Pt = [number, number];

/** منحنی هموار Catmull-Rom → Bézier (همان تابع smooth طرح) */
export function smooth(pts: Pt[]): string {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** نقاط پیوسته (بدون null) را جدا می‌کند تا نمودار در bucketهای خالی قطع شود */
export function segments(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push([x(i), y(v)]);
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

/** سقف «گرد» برای محور عمودی با ۴ بازه */
export function niceMax(v: number, min = 4): number {
  const target = Math.max(v, min);
  const mag = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 2.5, 4, 5, 10]) {
    if (m * mag >= target) return m * mag;
  }
  return 10 * mag;
}

export function idxFrom(e: MouseEvent<HTMLElement>, n: number): number {
  const b = e.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1))));
}

export function tipBox(i: number, n: number) {
  const x = n > 1 ? (i / (n - 1)) * 100 : 0;
  return { left: `${x}%`, transform: x > 70 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" };
}

/** نقطهٔ روی دایره؛ زاویه به درجه، ۰ = راست و مثبت = ساعت‌گرد (مثل SVG) */
export function polar(cx: number, cy: number, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** کمان ساعت‌گرد از زاویهٔ a0 تا a1 */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** رنگ‌های نمودارهای دایره‌ای (نسخه‌ها و ...) */
export const PALETTE = ["#26a379", "#4c8bf5", "#a855f7", "#14b8c4", "#f59e0b", "#ec4899", "#8b95a1"];

/** رنگ هر پلتفرم در همهٔ نمودارهای کلاینت‌ها */
export const PLATFORM_COLOR: Record<string, string> = {
  Windows: "#4c8bf5",
  Linux: "#f59e0b",
  macOS: "#a855f7",
  Android: "#26a379",
  iOS: "#ec4899",
  Web: "#14b8c4",
  نامشخص: "#8b95a1",
};
export const platformColor = (name: string) => PLATFORM_COLOR[name] ?? "#8b95a1";
