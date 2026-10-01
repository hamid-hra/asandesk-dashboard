import { bpsText, pctText, toFa, usedOfTotal } from "@/lib/fa";
import type { Live } from "@/lib/types";

import s from "./server.module.css";
import { lvl } from "./util";

export function LiveCard({
  live,
  cpuAvg,
  auto,
  onToggleAuto,
}: {
  live: Live | undefined;
  cpuAvg: number | null;
  auto: boolean;
  onToggleAuto: () => void;
}) {
  const a = live?.aggregate;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const rows = a
    ? [
        {
          label: "پردازنده",
          value: pctText(a.cpu),
          w: a.cpu,
          sub: `${cpuAvg == null ? "" : `میانگین بازه ${pctText(cpuAvg)} · `}${toFa(a.cores)} هسته`,
        },
        { label: "حافظه", value: a.ram == null ? "—" : pctText(a.ram), w: a.ram ?? 0, sub: usedOfTotal(a.ram_used, a.ram_total) },
        { label: "دیسک", value: a.disk == null ? "—" : pctText(a.disk), w: a.disk ?? 0, sub: usedOfTotal(a.disk_used, a.disk_total) },
        {
          label: "پهنای باند",
          value: bpsText(a.net_bps),
          w: a.net,
          sub: a.net_capacity_bps ? `ظرفیت کل ${bpsText(a.net_capacity_bps)}` : "ظرفیت لینک نامشخص",
        },
      ]
    : [];

  return (
    <div className={`card ${s.live}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>منابع لحظه‌ای</div>
        <button className={s.pill} aria-pressed={auto} onClick={onToggleAuto} title="به‌روزرسانی خودکار">
          <span />
          {auto ? "زنده" : "متوقف"}
        </button>
      </div>
      {!a && (
        <div className="empty" style={{ padding: "48px 8px" }}>
          {live && live.total === 0
            ? "هنوز هیچ سروری ثبت نشده است."
            : live
              ? "agent در حال حاضر گزارشی ارسال نمی‌کند."
              : "در حال دریافت…"}
        </div>
      )}
      {rows.map((l) => (
        <div key={l.label} className={s.liveRow}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className={s.liveLabel}>{l.label}</span>
            <span dir="ltr" className={s.liveValue}>
              {l.value}
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${clamp(l.w)}%`, background: lvl(l.w) }} />
          </div>
          <div className={s.liveSub}>{l.sub}</div>
        </div>
      ))}
      {a && (
        <div className={s.mini}>
          <div>
            <span>تأخیر میانگین</span>
            <span>{a.latency_ms == null ? "—" : `${toFa(Math.round(a.latency_ms))} ms`}</span>
          </div>
          <div>
            <span>سرورهای فعال</span>
            <span>
              {toFa(live!.online)} از {toFa(live!.total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
