"use client";

import { useMemo, useState } from "react";

import { KpiStrip } from "@/components/clients/KpiStrip";
import { errText } from "@/components/settings/ui";
import { PALETTE, platformColor } from "@/lib/chart";
import { fmt, pctText, toFa } from "@/lib/fa";
import type { ChartPlatform, ClientCharts } from "@/lib/types";

import s from "./charts.module.css";
import { InstallsChart } from "./InstallsChart";
import { Radar, type RadarSeries } from "./Radar";
import { RadialBars, type RadialItem } from "./RadialBars";
import { TickGauge } from "./TickGauge";

const TOP_VERSIONS = 5;
const OTHER_COLOR = "#8b95a1";

/** محورهای رادار پلتفرم‌ها: [کلید در پاسخ API، برچسب] */
const AXES: [keyof ChartPlatform, string][] = [
  ["installs", "نصب‌ها"],
  ["active_30d", "فعال ۳۰ روز"],
  ["online", "آنلاین الان"],
  ["new_30d", "نصب جدید"],
  ["logged", "وارد حساب"],
  ["on_latest", "آخرین نسخه"],
];

function ChartCard({ title, sub, actions, children, grow }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode; grow?: string }) {
  return (
    <section className={`card ${s.chartCard}`} style={grow ? { flex: grow } : undefined}>
      <header className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>{title}</div>
          {sub && <div className={s.cardSub}>{sub}</div>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** نمای «نمودارها» در تب کلاینت‌ها: نصب‌ها بر اساس نسخه و پلتفرم، روند نصب و سهم آخرین نسخه. */
export function ClientChartsView({ data, error, onRetry }: { data: ClientCharts | undefined; error?: unknown; onRetry?: () => void }) {
  const [scope, setScope] = useState<"installs" | "active_30d">("installs");

  const versionItems = useMemo<RadialItem[]>(() => {
    if (!data) return [];
    const rows = [...data.versions].sort((a, b) => b[scope] - a[scope]).filter((v) => v[scope] > 0);
    const platformParts = (counts: Record<string, number>) => Object.entries(counts).map(([label, value]) => ({ label, value, color: platformColor(label) }));
    const top = rows.slice(0, TOP_VERSIONS).map<RadialItem>((v, i) => ({
      label: v.version || "نامشخص",
      latin: !!v.version,
      value: v[scope],
      color: PALETTE[i % PALETTE.length],
      badge: v.latest ? "آخرین" : undefined,
      parts: platformParts(scope === "installs" ? v.platforms : v.platforms_active),
    }));
    const rest = rows.slice(TOP_VERSIONS);
    if (rest.length) {
      const merged: Record<string, number> = {};
      for (const v of rest) for (const [p, c] of Object.entries(scope === "installs" ? v.platforms : v.platforms_active)) merged[p] = (merged[p] ?? 0) + c;
      top.push({ label: `${toFa(rest.length)} نسخهٔ دیگر`, value: rest.reduce((n, v) => n + v[scope], 0), color: OTHER_COLOR, parts: platformParts(merged) });
    }
    return top;
  }, [data, scope]);

  const radarSeries = useMemo<RadarSeries[]>(() => {
    if (!data) return [];
    const sums = AXES.map(([key]) => data.platforms.reduce((n, p) => n + (p[key] as number), 0));
    return data.platforms.map((p) => ({
      name: p.platform,
      color: platformColor(p.platform),
      raw: AXES.map(([key]) => p[key] as number),
      values: AXES.map(([key], i) => (sums[i] ? (p[key] as number) / sums[i] : 0)),
    }));
  }, [data]);

  if (!data && error) {
    return (
      <div className={`card ${s.loading}`}>
        نمودارها بارگذاری نشد: {errText(error, "پاسخی از سرور نیامد.")}
        {onRetry && (
          <div style={{ marginTop: 12 }}>
            <button className="seg-retry" onClick={onRetry} style={{ height: 34, padding: "0 16px", border: "1px solid var(--input-border)", borderRadius: 10, background: "var(--surface)", color: "var(--text-2)", cursor: "pointer" }}>
              تلاش دوباره
            </button>
          </div>
        )}
      </div>
    );
  }
  if (!data) return <div className={`card ${s.loading}`}>در حال بارگذاری نمودارها…</div>;
  const t = data.totals;
  if (t.installs === 0) {
    return <div className="card empty">هنوز کلاینتی به پنل گزارش نداده است؛ بعد از اولین گزارش، نمودارها اینجا پر می‌شوند.</div>;
  }

  const kpis = [
    { label: "کل نصب‌ها", value: fmt(t.installs), sub: "دستگاه‌هایی که تا حالا گزارش داده‌اند" },
    { label: "فعال ۳۰ روز", value: fmt(t.active_30d), sub: `${pctText((t.active_30d / t.installs) * 100)} از کل نصب‌ها` },
    { label: "آنلاین هم‌اکنون", value: fmt(t.online), sub: "در یک دقیقهٔ اخیر گزارش داده‌اند" },
    { label: "نصب جدید · ۳۰ روز", value: fmt(t.new_30d), sub: "اولین گزارش‌شان در یک ماه اخیر بوده" },
    { label: "آخرین نسخهٔ پایدار", value: data.latest ?? "—", sub: data.latest ? `${fmt(t.on_latest)} کلاینت فعال روی آن` : "هنوز نسخه‌ای منتشر نشده" },
  ];

  const platformNames = data.platforms.map((p) => p.platform);
  return (
    <div className={s.page}>
      <KpiStrip items={kpis} />

      <div className={s.row}>
        <ChartCard title="روند نصب" sub="۹۰ روز اخیر، به وقت پنل" grow="2 1 560px">
          <InstallsChart daily={data.daily} platforms={platformNames} />
        </ChartCard>
        <ChartCard title="روی آخرین نسخه" sub="سهم کلاینت‌های فعال ۳۰ روز که به‌روز هستند" grow="1 1 300px">
          <TickGauge
            value={t.on_latest_share}
            label="کلاینت‌های به‌روز"
            sub={data.latest ? `${fmt(t.on_latest)} از ${fmt(t.active_30d)} کلاینت فعال روی ${data.latest} هستند` : "تا اولین نسخهٔ پایدار منتشر نشود، این شاخص خالی است"}
          />
        </ChartCard>
      </div>

      <div className={s.row}>
        <ChartCard
          title="سهم نسخه‌ها"
          sub="نصب‌ها به تفکیک نسخه؛ نوار کوچک کنار هر نسخه ویندوز و لینوکس را جدا می‌کند"
          grow="1 1 480px"
          actions={
            <div className="seg" role="group" aria-label="مبنای شمارش">
              <button aria-pressed={scope === "installs"} onClick={() => setScope("installs")}>همهٔ نصب‌ها</button>
              <button aria-pressed={scope === "active_30d"} onClick={() => setScope("active_30d")}>فعال ۳۰ روز</button>
            </div>
          }
        >
          {versionItems.length ? <RadialBars items={versionItems} caption="سهم هر نسخه از نصب‌ها" centerLabel={scope === "installs" ? "نصب" : "کلاینت فعال"} /> : <div className="empty">در این بازه کلاینتی نیست.</div>}
        </ChartCard>

        <ChartCard title="مقایسهٔ پلتفرم‌ها" sub="سهم هر پلتفرم از هر شاخص (هر محور ۱۰۰٪ = همهٔ پلتفرم‌ها)" grow="1 1 480px">
          <div className={s.platformBody}>
            <ul className={s.platformList}>
              {data.platforms.map((p) => (
                <li key={p.platform}>
                  <div>
                    <span className="dot" style={{ background: platformColor(p.platform) }} />
                    <span className={s.lgLabel}>{p.platform}</span>
                    <b>{fmt(p.installs)}</b>
                    <span className={s.lgPct}>{pctText(p.share)}</span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${p.share}%`, background: platformColor(p.platform) }} />
                  </div>
                </li>
              ))}
            </ul>
            <Radar axes={AXES.map(([, label]) => label)} series={radarSeries} caption="مقایسهٔ پلتفرم‌ها" />
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
