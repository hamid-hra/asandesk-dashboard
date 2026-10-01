import { fmt, pctText, toFa } from "@/lib/fa";
import type { ServerRow, ServerStatus } from "@/lib/types";

import s from "./server.module.css";
import { lvl } from "./util";

const ST: Record<ServerStatus, [string, string, string]> = {
  ok: ["عملیاتی", "var(--accent-soft)", "var(--accent-strong)"],
  high: ["بار بالا", "var(--warn-soft)", "var(--warn-text)"],
  maint: ["نگهداری", "var(--info-soft)", "var(--info-text)"],
  offline: ["قطع", "var(--danger-soft)", "var(--danger-strong)"],
};

function Meter({ v }: { v: number | null }) {
  return (
    <div className={s.meter}>
      <div>
        <div style={{ width: `${v ?? 0}%`, background: v == null ? "transparent" : lvl(v) }} />
      </div>
      <span>{v == null ? "—" : pctText(v)}</span>
    </div>
  );
}

export function ServersTable({ servers }: { servers: ServerRow[] }) {
  const totalConns = servers.reduce((a, x) => a + (x.conns ?? 0), 0);
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div className="card-title" style={{ flex: 1 }}>
          سرورها
        </div>
        <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {toFa(servers.length)} سرور · {fmt(totalConns)} کانکشن
        </span>
      </div>
      <div className={s.tableWrap}>
        <div className={s.table}>
          <div className={`${s.tr} ${s.th}`}>
            <span>سرور</span>
            <span>منطقه</span>
            <span>وضعیت</span>
            <span>CPU</span>
            <span>RAM</span>
            <span>کانکشن</span>
            <span>تأخیر</span>
          </div>
          {servers.map((x) => {
            const [label, bg, color] = ST[x.status];
            return (
              <div key={x.id} className={s.tr}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{x.name}</span>
                  <span dir="ltr" className="mono" style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: "var(--faint)", textAlign: "right" }}>
                    {x.ip || "—"}
                  </span>
                </div>
                <span style={{ color: "var(--text-2)" }}>{x.region || "—"}</span>
                <span className={s.status} style={{ background: bg, color }}>
                  {label}
                </span>
                <Meter v={x.cpu} />
                <Meter v={x.ram} />
                <span style={{ fontWeight: 600 }}>{x.conns == null ? "—" : fmt(x.conns)}</span>
                <span style={{ color: "var(--text-2)" }}>{x.latency_ms == null ? "—" : `${toFa(Math.round(x.latency_ms))} ms`}</span>
              </div>
            );
          })}
          {!servers.length && <div className="empty">هنوز سروری ثبت نشده است.</div>}
        </div>
      </div>
    </div>
  );
}
