"use client";

import Link from "next/link";
import { useState } from "react";

import { KpiStrip } from "@/components/clients/KpiStrip";
import { InfoTip } from "@/components/Tip";
import { idxFrom, niceMax, tipBox } from "@/lib/chart";
import { dfDay, fmt, pctText, toFa } from "@/lib/fa";
import { agoText } from "@/lib/people";
import type { ConnFailures, FailureDay, FailureGroup } from "@/lib/types";

import s from "./charts.module.css";

const H = 220;
const TOP = 18;

/** Whose side a failure is on; the order is the stacking order of the bars (bottom first). */
const GROUPS: { id: FailureGroup; label: string; color: string; tip: string }[] = [
  { id: "server", label: "سرور", color: "#d0394f", tip: "سرور شناسه یا رله جواب نداد یا در دسترس نبود" },
  { id: "network", label: "شبکه", color: "#a855f7", tip: "شبکه بین دو دستگاه قطع شد یا به دستگاه مقابل نرسید" },
  { id: "peer", label: "دستگاه مقابل", color: "#f59e0b", tip: "دستگاه مقابل آفلاین بود، رد کرد یا اجازه نداد" },
  { id: "user", label: "کاربر", color: "#4c8bf5", tip: "شناسه یا رمز اشتباه وارد شد" },
  { id: "other", label: "سایر", color: "#8b95a1", tip: "خطاهایی که برنامه دسته‌بندی‌شان نکرد؛ متن خطا در فهرست آخرین‌ها هست" },
];
const GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<FailureGroup, (typeof GROUPS)[number]>;

/** Reason codes the app sends (conn_failure_reason in the app's src/asandesk.rs): label and explanation */
const REASONS: Record<string, [string, string]> = {
  server_unreachable: ["سرور شناسه در دسترس نبود", "برنامه اصلاً به سرور شناسه وصل نشد: سرور یا پورت آن بسته است، نام دامنه پیدا نشد یا اینترنت خود کاربر قطع بود."],
  server_no_answer: ["درخواست از راه سرور بی‌پاسخ ماند", "به سرور شناسه وصل شد ولی در ۱۸ ثانیه جوابی برنگشت: یا سرور شناسه جواب نداد، یا دستگاه مقابل از راه سرور پاسخ نداد."],
  server_error: ["خطای سرور شناسه", "دست‌دادن رمزنگاری با سرور شناسه شکست خورد یا اتصال سرور وسط کار قطع شد."],
  relay_failed: ["سرور رله وصل نشد", "اتصال از راه سرور رله (hbbr) برقرار نشد."],
  key_mismatch: ["کلید سرور نادرست", "کلید عمومی سرور با کلید داخل برنامه یکی نیست."],
  id_not_exist: ["شناسهٔ اشتباه", "شناسه‌ای که کاربر وارد کرد روی سرور وجود ندارد."],
  wrong_password: ["رمز اشتباه", "رمز واردشده برای دستگاه مقابل درست نبود."],
  wrong_2fa: ["کد دومرحله‌ای اشتباه", "کد تأیید دومرحله‌ای درست نبود."],
  too_many_attempts: ["تلاش ناموفق زیاد", "بعد از چند رمز اشتباه، دستگاه مقابل موقتاً اتصال را قفل کرد."],
  offline: ["دستگاه مقابل آفلاین", "دستگاه مقابل خاموش است یا به سرور وصل نیست."],
  rejected: ["طرف مقابل رد کرد", "کاربر دستگاه مقابل درخواست را رد کرد یا تا پایان شمارش معکوس جواب نداد."],
  not_allowed: ["دستگاه مقابل اجازه نداد", "تنظیمات دستگاه مقابل این اتصال را نمی‌پذیرد (فقط ورودی، مسدودسازی شناسه یا IP، نبود دسترسی و …)."],
  peer_closed: ["دستگاه مقابل اتصال را بست", "دستگاه مقابل پیش از ورود، اتصال را بست."],
  peer_unreachable: ["به دستگاه مقابل نرسید", "اتصال مستقیم یا WebRTC به دستگاه مقابل برقرار نشد."],
  timeout: ["مهلت پاسخ تمام شد", "دستگاه مقابل یا سرور در مهلت مقرر جواب نداد."],
  network: ["خطای شبکه", "بعد از رسیدن به دستگاه مقابل، شبکه خطا داد یا قطع شد."],
  dropped: ["قطع وسط جلسه", "جلسه برقرار شده بود و وسط کار قطع شد."],
  other: ["سایر", "خطایی که برنامه دسته‌بندی‌اش نکرد؛ متن خطا در فهرست آخرین‌ها آمده است."],
};
const reasonLabel = (r: string) => REASONS[r]?.[0] ?? r;

const TYPE_LABEL: Record<string, string> = { desktop: "ریموت", file: "انتقال فایل", camera: "دوربین", terminal: "ترمینال", tunnel: "تونل" };

const dayText = (iso: string) => dfDay.format(new Date(`${iso}T12:00:00`));
const tickLabel = (v: number) => toFa(Number.isInteger(v) ? v : v.toFixed(1));

function Card({ title, sub, actions, children, grow }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode; grow?: string }) {
  return (
    <section className={`card ${s.chartCard}`} style={grow ? { flex: grow } : undefined}>
      <header className={s.cardHead}>
        <div>
          <div className={s.cardTitle} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {title}
            {sub && <InfoTip text={sub} />}
          </div>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Failed attempts per day, stacked by side; a side can be shown alone from the legend. */
function FailuresChart({ daily }: { daily: FailureDay[] }) {
  const [only, setOnly] = useState<FailureGroup | "all">("all");
  const [hover, setHover] = useState<number | null>(null);
  const n = daily.length;
  const shown = only === "all" ? GROUPS : GROUPS.filter((g) => g.id === only);
  const valueOf = (d: FailureDay) => shown.reduce((sum, g) => sum + (d.groups[g.id] ?? 0), 0);
  const maxV = niceMax(Math.max(0, ...daily.map(valueOf)), 4);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500);
  const barW = (1000 / Math.max(1, n)) * 0.62;
  const ticks = [0, 1, 2, 3, 4].map((k) => {
    const yy = TOP + (k / 4) * (H - TOP);
    return { y: yy, top: `${(yy / H) * 100}%`, label: tickLabel((maxV * (4 - k)) / 4) };
  });
  const labelAt = [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];
  const hd = hover != null ? daily[hover] : null;

  return (
    <div className={s.trend}>
      <div className={s.trendTop}>
        <div className={s.dotLegend} role="group" aria-label="سمت مشکل">
          <button type="button" aria-pressed={only === "all"} onClick={() => setOnly("all")}>
            همه
          </button>
          {GROUPS.map((g) => (
            <button key={g.id} type="button" title={g.tip} aria-pressed={only === g.id} onClick={() => setOnly(only === g.id ? "all" : g.id)}>
              <i style={{ background: g.color }} />
              {g.label}
            </button>
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
            {ticks.map((t) => (
              <line key={t.y} x1="0" x2="1000" y1={t.y} y2={t.y} stroke="var(--grid)" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
            ))}
            {daily.map((d, i) => {
              let base = H;
              return shown.map((g) => {
                const v = d.groups[g.id] ?? 0;
                if (!v) return null;
                const h = (v / maxV) * (H - TOP);
                base -= h;
                return <rect key={`${i}-${g.id}`} x={x(i) - barW / 2} y={base} width={barW} height={h} fill={g.color} opacity={hover === i || hover === null ? 1 : 0.55} rx="2" />;
              });
            })}
          </svg>
          {daily.every((d) => valueOf(d) === 0) && <div className={s.noData}>در این بازه اتصال ناموفقی گزارش نشده</div>}
          {hd && hover != null && (
            <>
              <div className={s.cursor} style={{ left: tipBox(hover, n).left }} />
              <div dir="rtl" className={s.tip} style={tipBox(hover, n)}>
                <div className={s.tipTitle}>{dayText(hd.date)}</div>
                <div className={s.tipRow}>
                  <span>اتصال ناموفق</span>
                  <b>{fmt(valueOf(hd))}</b>
                </div>
                {shown
                  .filter((g) => hd.groups[g.id])
                  .map((g) => (
                    <div key={g.id} className={s.tipRow}>
                      <span className="dot" style={{ background: g.color }} />
                      <span>{g.label}</span>
                      <b>{fmt(hd.groups[g.id] ?? 0)}</b>
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

/** «اتصال‌های ناموفق» in the clients charts view: why connection attempts fail, by side and reason. */
export function FailuresSection({ data }: { data: ConnFailures }) {
  const server = data.groups.server ?? 0;
  const attempts = data.total + data.sessions;
  const kpis = [
    { label: `اتصال ناموفق · ${toFa(data.days)} روز`, value: fmt(data.total), sub: `از ${fmt(data.devices)} دستگاه` },
    { label: "۲۴ ساعت اخیر", value: fmt(data.last_24h), sub: "اتصال ناموفق در یک روز گذشته" },
    {
      label: "مشکل از سرور",
      value: data.total ? pctText((server / data.total) * 100) : "—",
      sub: data.total ? `${fmt(server)} مورد: سرور شناسه یا رله جواب نداد` : "هنوز گزارشی نیامده",
    },
    {
      label: "سهم ناموفق (تقریبی)",
      value: attempts ? pctText((data.total / attempts) * 100) : "—",
      sub: `${fmt(data.sessions)} جلسهٔ موفق در همین بازه`,
    },
  ];

  return (
    <>
      <KpiStrip items={kpis} />
      <div className={s.row}>
        <Card
          title="اتصال‌های ناموفق"
          sub={`هر بار که کاربری در ${toFa(data.days)} روز اخیر نتوانست وصل شود، به تفکیک سمت مشکل. فقط برنامه‌هایی که «ارسال اطلاعات برای پشتیبانی» روشن دارند گزارش می‌دهند؛ تلاش‌های پشت‌سرهم یک کاربر به یک دستگاه با یک دلیل، هر ۳۰ ثانیه یک بار شمرده می‌شوند.`}
          grow="2 1 560px"
        >
          <FailuresChart daily={data.daily} />
        </Card>
        <Card title="دلیل‌ها" sub="هر دلیل با رنگ سمت مشکل؛ روی نام هر دلیل بمانید تا توضیحش را ببینید" grow="1 1 340px">
          {data.reasons.length ? (
            <ul className={s.platformList}>
              {data.reasons.map((r) => (
                <li key={r.reason} title={REASONS[r.reason]?.[1]}>
                  <div>
                    <span className="dot" style={{ background: GROUP[r.group]?.color }} />
                    <span className={s.lgLabel}>{reasonLabel(r.reason)}</span>
                    <b>{fmt(r.count)}</b>
                    <span className={s.lgPct}>{pctText((r.count / data.total) * 100)}</span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${(r.count / data.reasons[0].count) * 100}%`, background: GROUP[r.group]?.color }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">در این بازه اتصال ناموفقی گزارش نشده است.</div>
          )}
        </Card>
      </div>
      {data.recent.length > 0 && (
        <Card title="آخرین اتصال‌های ناموفق" sub="دستگاهی که تلاش کرد، شناسه‌ای که می‌خواست به آن وصل شود، دلیل و متن خطای خود برنامه">
          <div className={s.failList}>
            {data.recent.map((f, i) => (
              <div key={`${f.at}-${i}`} className={s.failRow}>
                <span className="dot" style={{ background: GROUP[f.group]?.color }} />
                <div className={s.failMain}>
                  <div>
                    <b>{reasonLabel(f.reason)}</b>
                    <span className={s.failMeta}>
                      <Link href={`/clients?id=${encodeURIComponent(f.device)}`}>{f.device_name}</Link>
                      {f.peer && (
                        <>
                          {" ← "}
                          <span className="mono">{f.peer}</span>
                        </>
                      )}
                      {f.type && ` · ${TYPE_LABEL[f.type] ?? f.type}`}
                      {f.version && (
                        <>
                          {" · "}
                          <span className="mono">{f.version}</span>
                        </>
                      )}
                    </span>
                  </div>
                  {f.detail && (
                    <div dir="ltr" className={`mono ${s.failDetail}`}>
                      {f.detail}
                    </div>
                  )}
                </div>
                <span className={s.failAt} title={new Date(f.at).toLocaleString("fa-IR")}>
                  {agoText(f.at)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
