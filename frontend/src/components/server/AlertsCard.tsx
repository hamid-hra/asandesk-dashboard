"use client";

import useSWR from "swr";

import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { eventTime, toFa } from "@/lib/fa";
import { useToast } from "@/lib/toast";
import type { Alert } from "@/lib/types";

import s from "./server.module.css";

const LVL = {
  crit: { label: "بحرانی", dot: "var(--danger)", bg: "var(--danger-soft)", color: "var(--danger-strong)" },
  warn: { label: "هشدار", dot: "var(--warn)", bg: "var(--warn-soft)", color: "var(--warn-text)" },
  info: { label: "اطلاع", dot: "var(--info)", bg: "var(--info-soft)", color: "var(--info-text)" },
};

export function AlertsCard({ refresh }: { refresh: number }) {
  const { user } = useAuth();
  const flash = useToast();
  const { data, mutate } = useSWR<Alert[]>("/api/monitoring/alerts", fetcher, { refreshInterval: refresh });
  const alerts = data ?? [];

  const ack = async (id: number) => {
    await mutate(alerts.filter((a) => a.id !== id), { revalidate: false });
    await api(`/api/monitoring/alerts/${id}/ack`, { method: "POST" }).catch(() => {});
    mutate();
  };
  const ackAll = async () => {
    if (!alerts.length) return;
    await mutate([], { revalidate: false });
    await api("/api/monitoring/alerts/ack-all", { method: "POST" }).catch(() => {});
    flash("همه هشدارها بررسی شد");
    mutate();
  };

  return (
    <div id="alerts" className="card" style={{ flex: "1 1 460px", minWidth: 0, display: "flex", flexDirection: "column", scrollMarginTop: 80 }}>
      <div className="card-head">
        <span className="card-title">هشدارها و رویدادها</span>
        <span className={s.count}>{toFa(alerts.length)}</span>
        <span style={{ flex: 1 }} />
        {user.can_manage && (
          <button className={s.linkBtn} onClick={ackAll}>
            بررسی همه
          </button>
        )}
      </div>
      {alerts.map((a) => {
        const l = LVL[a.level];
        const resolved = a.resolved_at && a.kind !== "connected";
        return (
          <div key={a.id} className={s.alert}>
            <span className="dot" style={{ width: 9, height: 9, background: l.dot }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className={s.alertTitle}>{a.title}</span>
                <span className={s.lvl} style={{ background: l.bg, color: l.color }}>
                  {l.label}
                </span>
              </div>
              <span className={s.alertSub}>
                {a.detail}
                {resolved ? " · رفع شد" : ""}
              </span>
            </div>
            <span className={s.alertTime}>{eventTime(a.opened_at)}</span>
            {user.can_manage && (
              <button className={s.ack} onClick={() => ack(a.id)} title="بررسی شد" aria-label="بررسی شد">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      {data && !alerts.length && <div className="empty">هشدار فعالی وجود ندارد</div>}
    </div>
  );
}
