"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import s from "@/components/clients/clients.module.css";
import { KpiStrip } from "@/components/clients/KpiStrip";
import { SearchBox, Seg } from "@/components/clients/SearchBox";
import { TicketView } from "@/components/tickets/TicketView";
import { fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { categoryText, TICKET_STATUS, whenText } from "@/lib/people";
import type { TicketRow, TicketStats } from "@/lib/types";

// «call» = جدیدهایی که کاربر شماره تماس گذاشته؛ پشتیبانی باید با آن‌ها تماس بگیرد
type Filter = "open" | "call" | "closed" | "all";
const FILTERS: [Filter, string][] = [
  ["open", "جدید"],
  ["call", "نیازمند تماس"],
  ["closed", "بررسی‌شده"],
  ["all", "همه"],
];

function TicketsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const idParam = useSearchParams().get("id");
  const selected = idParam && /^\d+$/.test(idParam) ? Number(idParam) : null;
  // با لینک مستقیم به یک بازخورد، فهرست «همه» نمایش داده می‌شود تا در فهرست دیده شود
  const [filter, setFilter] = useState<Filter>(selected ? "all" : "open");
  const [q, setQ] = useState("");
  const { mutate: globalMutate } = useSWRConfig();

  const params = new URLSearchParams({ status: filter === "call" ? "open" : filter, q });
  if (filter === "call") params.set("contact", "1");
  const { data: list, mutate } = useSWR<TicketRow[]>(`/api/tickets?${params}`, fetcher, { refreshInterval: 20000, keepPreviousData: true });
  const { data: st, mutate: mutateStats } = useSWR<TicketStats>("/api/tickets/stats", fetcher, { refreshInterval: 30000 });

  const select = (id: number) => router.replace(`${pathname}?id=${id}`, { scroll: false });
  const firstId = list?.[0]?.id;
  useEffect(() => {
    // مثل طرح: اولین بازخورد فهرست از ابتدا باز است
    if (!selected && firstId) router.replace(`${pathname}?id=${firstId}`, { scroll: false });
  }, [selected, firstId, router, pathname]);

  const kpis = [
    { label: "بازخوردهای جدید", value: st ? toFa(st.open) : "—", sub: "هنوز بررسی نشده" },
    { label: "نیازمند تماس", value: st ? toFa(st.open_with_contact) : "—", sub: "راه تماس گذاشته‌اند" },
    { label: "۷ روز اخیر", value: st ? toFa(st.last_7d) : "—", sub: "بازخورد رسیده" },
    { label: "بررسی‌شده", value: st ? toFa(st.closed) : "—", sub: "در مجموع" },
  ];

  const onChanged = () => {
    mutate();
    mutateStats();
    globalMutate("/api/monitoring/status");
  };

  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>بازخوردها</div>
        <div className={s.subtitle}>مشکل و پیشنهادی که کاربران از داخل اپلیکیشن فرستاده‌اند؛ به کاربر پیامی فرستاده نمی‌شود و فقط با کسی که شماره گذاشته تماس می‌گیریم</div>
      </div>
      <KpiStrip items={kpis} />
      <div className={s.split}>
        <div className={`card ${s.tList}`}>
          <div className={s.tToolbar}>
            <SearchBox value={q} onChange={setQ} placeholder="موضوع، شماره تماس یا کاربر…" />
            <div style={{ alignSelf: "flex-start" }}>
              <Seg options={FILTERS} value={filter} onChange={setFilter} wrap />
            </div>
          </div>
          {list?.map((t) => (
            <button key={t.id} className={s.tItem} aria-current={t.id === selected} onClick={() => select(t.id)}>
              <div className={s.tItemTop}>
                <span className="dot" style={{ background: TICKET_STATUS[t.status][1] }} title={TICKET_STATUS[t.status][0]} />
                <span>{t.subject}</span>
                <span style={{ fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{whenText(t.created_at)}</span>
              </div>
              <div className={s.tItemSub}>
                <span dir="ltr" className="mono" style={{ fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>
                  {t.code}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>· {t.client.display}</span>
                <span style={{ flex: 1 }} />
                {t.contact && (
                  <span dir="ltr" className={`${s.chip} mono`} style={{ fontWeight: 600, background: "var(--accent-soft)", color: "var(--accent-strong)" }} title="راه تماس گذاشته است">
                    {t.contact}
                  </span>
                )}
                {t.has_log && (
                  <span className={s.chip} style={{ background: "var(--info-soft)", color: "var(--info-text)" }} title="لاگ برنامه پیوست است">
                    لاگ
                  </span>
                )}
                {t.image_count > 0 && (
                  <span className={s.chip} style={{ background: "var(--info-soft)", color: "var(--info-text)" }} title="تصویر پیوست است">
                    {toFa(t.image_count)} تصویر
                  </span>
                )}
                {t.category && (
                  <span className={s.chip} style={{ background: "var(--seg-track)", color: "var(--muted)" }}>
                    {categoryText(t.category)}
                  </span>
                )}
              </div>
            </button>
          ))}
          {list && !list.length && <div className="empty">بازخوردی پیدا نشد</div>}
          {!list && <div className="empty">در حال بارگذاری…</div>}
        </div>
        {selected ? (
          <TicketView key={selected} id={selected} onChanged={onChanged} />
        ) : (
          <div className={`card ${s.tDetail}`}>
            <div className="empty">یک بازخورد را از فهرست انتخاب کنید.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Suspense>
      <TicketsInner />
    </Suspense>
  );
}
