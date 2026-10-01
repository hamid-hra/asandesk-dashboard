"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { fetcher } from "@/lib/api";
import { eventTime, toFa } from "@/lib/fa";
import type { ClientRow } from "@/lib/types";

import s from "./clients.module.css";

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const { data } = useSWR<ClientRow[]>(
    `/api/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    fetcher,
    { refreshInterval: 30000, keepPreviousData: true },
  );
  const rows = data ?? [];
  const online = rows.filter((r) => r.online).length;

  return (
    <div className={s.page}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div className="card-title" style={{ flex: 1 }}>
            کلاینت‌ها
          </div>
          <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {toFa(rows.length)} دستگاه · {toFa(online)} آنلاین
          </span>
        </div>
        <div className={s.toolbar}>
          <input
            className={s.search}
            placeholder="جست‌وجوی نام، کد دستگاه یا IP…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className={s.table}>
          <div className={`${s.tr} ${s.th}`}>
            <span>دستگاه</span>
            <span>سیستم‌عامل</span>
            <span>نسخه</span>
            <span>موقعیت</span>
            <span>وضعیت</span>
            <span>آخرین فعالیت</span>
          </div>
          {rows.map((r) => (
            <Link key={r.id} href={`/clients/${r.id}`} className={s.tr}>
              <div className={s.name}>
                <span style={{ fontWeight: 600 }}>{r.display_name}</span>
                <span dir="ltr" className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>
                  {toFa(r.rid)}
                </span>
              </div>
              <span style={{ color: "var(--text-2)" }}>{r.os || "—"}</span>
              <span dir="ltr" style={{ color: "var(--text-2)" }}>{r.version ? toFa(r.version) : "—"}</span>
              <span style={{ color: "var(--text-2)" }}>{r.location || "—"}</span>
              <span className={s.badge} data-kind={r.blocked ? "blocked" : r.online ? "online" : "offline"}>
                {r.blocked ? "مسدود" : r.online ? "آنلاین" : "آفلاین"}
              </span>
              <span style={{ color: "var(--muted)" }}>{r.last_seen ? eventTime(r.last_seen) : "—"}</span>
            </Link>
          ))}
          {!rows.length && <div className="empty">هنوز کلاینتی گزارش نداده است.</div>}
        </div>
      </div>
    </div>
  );
}
