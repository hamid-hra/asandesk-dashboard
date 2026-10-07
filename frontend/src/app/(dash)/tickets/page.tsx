"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import s from "@/components/clients/clients.module.css";
import { KpiStrip } from "@/components/clients/KpiStrip";
import { SearchBox, Seg } from "@/components/clients/SearchBox";
import { TicketView } from "@/components/tickets/TicketView";
import { fetcher } from "@/lib/api";
import { pctText, toFa } from "@/lib/fa";
import { categoryText, minutesText, PRIORITY, TICKET_STATUS, whenText } from "@/lib/people";
import type { ReleaseStats, TicketRow, TicketStats } from "@/lib/types";

type Filter = "open" | "pending" | "closed" | "all";
const FILTERS: [Filter, string][] = [
  ["open", "جدید"],
  ["pending", "پاسخ داده شد"],
  ["closed", "بسته"],
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

  const params = new URLSearchParams({ status: filter, q });
  const { data: list, mutate } = useSWR<TicketRow[]>(`/api/tickets?${params}`, fetcher, { refreshInterval: 20000, keepPreviousData: true });
  const { data: st, mutate: mutateStats } = useSWR<TicketStats>("/api/tickets/stats", fetcher, { refreshInterval: 30000 });
  const { data: rel } = useSWR<ReleaseStats>("/api/releases/stats", fetcher);

  const select = (id: number) => router.replace(`${pathname}?id=${id}`, { scroll: false });
  const firstId = list?.[0]?.id;
  useEffect(() => {
    // مثل طرح: اولین بازخورد فهرست از ابتدا باز است
    if (!selected && firstId) router.replace(`${pathname}?id=${firstId}`, { scroll: false });
  }, [selected, firstId, router, pathname]);

  const frDelta = st?.first_response_min != null && st.first_response_prev_min != null ? st.first_response_min - st.first_response_prev_min : null;
  const kpis = [
    { label: "بازخوردهای جدید", value: st ? toFa(st.open) : "—", sub: "نیازمند بررسی" },
    { label: "پاسخ داده‌شده", value: st ? toFa(st.pending) : "—", sub: "منتظر نتیجه" },
    {
      label: "میانگین اولین پاسخ",
      value: st?.first_response_min == null ? "—" : minutesText(st.first_response_min),
      sub:
        frDelta == null
          ? "۷ روز اخیر"
          : `${frDelta <= 0 ? "−" : "+"}${minutesText(Math.abs(frDelta))} نسبت به هفته قبل`,
    },
    {
      label: "بسته‌شده · ۷ روز",
      value: st ? toFa(st.resolved_7d) : "—",
      sub: st?.resolved_fast_share == null ? "—" : `${pctText(st.resolved_fast_share)} در کمتر از ۲۴ ساعت`,
    },
    { label: "رضایت کاربران", value: st?.satisfaction == null ? "—" : pctText(st.satisfaction), sub: "نظرسنجی هنوز فعال نیست" },
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
        <div className={s.subtitle}>مشکل و پیشنهادی که کاربران از داخل اپلیکیشن فرستاده‌اند؛ لاگ برنامه همراه هر مورد است</div>
      </div>
      <KpiStrip items={kpis} />
      <div className={s.split}>
        <div className={`card ${s.tList}`}>
          <div className={s.tToolbar}>
            <SearchBox value={q} onChange={setQ} placeholder="موضوع، شماره یا کاربر…" />
            <div style={{ alignSelf: "flex-start" }}>
              <Seg options={FILTERS} value={filter} onChange={setFilter} wrap />
            </div>
          </div>
          {list?.map((t) => {
            const [prLabel, prBg, prColor] = PRIORITY[t.priority];
            return (
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
                  <span className={s.chip} style={{ fontWeight: 600, background: prBg, color: prColor }}>
                    {prLabel}
                  </span>
                  {t.has_log && (
                    <span className={s.chip} style={{ background: "var(--info-soft)", color: "var(--info-text)" }} title="لاگ برنامه پیوست است">
                      لاگ
                    </span>
                  )}
                  {t.category && (
                    <span className={s.chip} style={{ background: "var(--seg-track)", color: "var(--muted)" }}>
                      {categoryText(t.category)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {list && !list.length && <div className="empty">بازخوردی پیدا نشد</div>}
          {!list && <div className="empty">در حال بارگذاری…</div>}
        </div>
        {selected ? (
          <TicketView key={selected} id={selected} latest={rel?.latest_stable ?? null} onChanged={onChanged} />
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
