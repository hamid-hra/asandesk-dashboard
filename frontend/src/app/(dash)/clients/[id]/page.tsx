"use client";

import Link from "next/link";
import { use, useState } from "react";
import useSWR from "swr";

import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { durationShort, durationText, eventTime, hoursText, toFa } from "@/lib/fa";
import { useToast } from "@/lib/toast";
import type { ClientDetail } from "@/lib/types";

import s from "../clients.module.css";

const DAY = 86400000;

function dailyBars(sessions: ClientDetail["sessions"], days = 14) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - (days - 1) * DAY;
  const buckets = new Array(days).fill(0);
  for (const se of sessions) {
    const t = new Date(se.started_at).getTime();
    const idx = Math.floor((t - start) / DAY);
    if (idx >= 0 && idx < days) buckets[idx] += se.duration_seconds;
  }
  const max = Math.max(1, ...buckets);
  return buckets.map((v) => ({ v, h: Math.round((v / max) * 100) }));
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const { data: c, mutate } = useSWR<ClientDetail>(`/api/clients/${id}`, fetcher, {
    refreshInterval: 20000,
  });

  if (!c) return <div className={s.page}><div className="card"><div className="empty">در حال بارگذاری…</div></div></div>;

  const sess = c.sessions ?? [];
  const since30 = Date.now() - 30 * DAY;
  const recent = sess.filter((x) => new Date(x.started_at).getTime() >= since30);
  const totalSec = recent.reduce((a, x) => a + x.duration_seconds, 0);
  const avgSec = recent.length ? Math.round(totalSec / recent.length) : 0;
  const bars = dailyBars(sess);

  async function act(path: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      await api(`/api/clients/${id}/${path}`, { method: "POST", body });
      toast(ok);
      await mutate();
    } catch {
      toast("خطا در اجرای فرمان");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.page}>
      <div className={s.back}>
        <Link href="/clients">‹ همهٔ کلاینت‌ها</Link>
      </div>

      <div className="card">
        {/* سرصفحه */}
        <div className={s.detailHead}>
          <div className={s.avatar}>{(c.display_name || "?").slice(0, 1).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.dname}>{c.display_name}</div>
            <div dir="ltr" className="mono" style={{ fontSize: 12.5, color: "var(--faint)", textAlign: "right" }}>
              {toFa(c.rid)}
            </div>
          </div>
          <div className={s.badges}>
            <span className={s.badge} data-kind={c.online ? "online" : "offline"}>
              {c.online ? "آنلاین" : "آفلاین"}
            </span>
            {c.blocked && <span className={s.badge} data-kind="blocked">مسدود</span>}
          </div>
        </div>

        {/* KPIها */}
        <div className={s.kpis}>
          <div className={s.kpi}>
            <span className={s.kpiLabel}>مدت اتصال (۳۰ روز)</span>
            <span className={s.kpiValue}>{hoursText(totalSec)}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiLabel}>تعداد نشست (۳۰ روز)</span>
            <span className={s.kpiValue}>{toFa(recent.length)}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiLabel}>میانگین هر نشست</span>
            <span className={s.kpiValue}>{avgSec ? durationText(avgSec) : "—"}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiLabel}>کل نشست‌ها</span>
            <span className={s.kpiValue}>{toFa(c.sessions_total)}</span>
          </div>
        </div>

        {/* نمودار روزانه */}
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span>مدت اتصال روزانه</span>
            <span style={{ color: "var(--faint)", fontWeight: 400 }}>۱۴ روز اخیر</span>
          </div>
          <div className={s.chart}>
            {bars.map((b, i) => (
              <div key={i} className={s.barCol} title={durationText(b.v)}>
                <div className={s.barFill} style={{ height: `${b.h}%`, opacity: b.v ? 1 : 0.25 }} />
              </div>
            ))}
          </div>
        </div>

        {/* مشخصات */}
        <div className={s.info}>
          <Row label="سیستم‌عامل" value={c.os || "—"} />
          <Row label="نسخه برنامه" value={c.version ? toFa(c.version) : "—"} ltr />
          <Row label="موقعیت" value={c.location || "—"} />
          <Row label="CPU" value={c.cpu || "—"} />
          <Row label="حافظه" value={c.memory ? `${toFa(c.memory)} GB` : "—"} ltr />
          <Row label="اولین نصب" value={c.first_seen ? eventTime(c.first_seen) : "—"} />
          <Row label="آخرین فعالیت" value={c.last_seen ? eventTime(c.last_seen) : "—"} />
        </div>

        {/* نشست‌ها */}
        <div className={s.section}>
          <div className={s.sectionHead}><span>آخرین نشست‌ها</span></div>
          <div className={s.sessions}>
            {sess.slice(0, 20).map((x) => (
              <div key={x.id} className={s.sessionRow}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontWeight: 600 }}>
                    {x.peer_name || x.peer_id || "نامشخص"}
                    {x.peer_id && <span dir="ltr" className="mono" style={{ fontSize: 11, color: "var(--faint)", marginRight: 6 }}>{toFa(x.peer_id)}</span>}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{eventTime(x.started_at)}</span>
                </div>
                <span style={{ color: "var(--text-2)", fontSize: 13 }}>{durationShort(x.duration_seconds)}</span>
              </div>
            ))}
            {!sess.length && <div className="empty">نشستی ثبت نشده است.</div>}
          </div>
        </div>

        {/* فرمان‌های پشتیبانی */}
        {user?.can_manage && (
          <div className={s.actions}>
            <button
              className={s.btn}
              data-kind="warn"
              disabled={busy}
              onClick={() => act("disconnect", {}, "فرمان خروج اجباری ارسال شد")}
            >
              خروج اجباری
            </button>
            <button
              className={s.btn}
              data-kind={c.blocked ? "ok" : "danger"}
              disabled={busy}
              onClick={() => act("block", { blocked: !c.blocked }, c.blocked ? "مسدودیت برداشته شد" : "دستگاه مسدود شد")}
            >
              {c.blocked ? "رفع مسدودیت" : "مسدودسازی"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoLabel}>{label}</span>
      <span className={s.infoValue} dir={ltr ? "ltr" : undefined}>{value}</span>
    </div>
  );
}
