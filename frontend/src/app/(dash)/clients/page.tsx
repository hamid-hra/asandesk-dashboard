"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";

import { ClientPanel } from "@/components/clients/ClientPanel";
import { ClientTable } from "@/components/clients/ClientTable";
import s from "@/components/clients/clients.module.css";
import { KpiStrip } from "@/components/clients/KpiStrip";
import { SearchBox, Seg } from "@/components/clients/SearchBox";
import { fetcher } from "@/lib/api";
import { fmt, pctText, toFa } from "@/lib/fa";
import { minutesText } from "@/lib/people";
import type { ClientList, ClientStats } from "@/lib/types";

type Filter = "all" | "online" | "logged" | "guest" | "tickets" | "blocked";
type Sort = "recent" | "mins" | "sessions" | "tickets";

const FILTERS: [Filter, string][] = [
  ["all", "همه"],
  ["online", "آنلاین"],
  ["logged", "وارد شده"],
  ["guest", "مهمان"],
  ["tickets", "دارای بازخورد جدید"],
  ["blocked", "مسدود"],
];
const SORTS: [Sort, string][] = [
  ["recent", "آخرین فعالیت"],
  ["mins", "مدت اتصال"],
  ["sessions", "نشست"],
  ["tickets", "بازخورد"],
];

function ClientsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const selected = useSearchParams().get("id");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [q, setQ] = useState("");

  const params = new URLSearchParams({ filter, sort, q });
  const { data: list, mutate } = useSWR<ClientList>(`/api/clients?${params}`, fetcher, { refreshInterval: 30000, keepPreviousData: true });
  const { data: st, mutate: mutateStats } = useSWR<ClientStats>("/api/clients/stats", fetcher, { refreshInterval: 30000 });

  const select = (id: string | null) => router.replace(id ? `${pathname}?id=${encodeURIComponent(id)}` : pathname, { scroll: false });
  const guest = st?.logged_share == null ? null : 100 - st.logged_share;

  const kpis = [
    { label: "کل کلاینت‌ها", value: st ? fmt(st.total) : "—", sub: st ? `+${toFa(st.new_7d)} در ۷ روز اخیر` : "" },
    { label: "آنلاین هم‌اکنون", value: st ? fmt(st.online) : "—", sub: st ? `از ${fmt(st.active_30d)} کلاینت فعال ۳۰ روز` : "" },
    { label: "وارد حساب شده", value: st?.logged_share == null ? "—" : pctText(st.logged_share), sub: guest == null ? "بدون داده" : `${pctText(guest)} مهمان بدون ورود` },
    {
      label: "میانگین اتصال روزانه",
      value: st?.avg_daily_minutes == null ? "—" : minutesText(st.avg_daily_minutes),
      sub: "به ازای هر کلاینت فعال",
    },
    { label: "نشست‌ها · ۳۰ روز", value: st ? fmt(st.sessions_30d) : "—", sub: "اتصال‌های موفق گزارش‌شده" },
    {
      label: "پلتفرم غالب",
      value: st?.platforms.length ? st.platforms[0][0] : "—",
      sub: st?.platforms.length ? st.platforms.map(([p, v]) => `${p} ${pctText(v * 100)}`).join(" · ") : "بدون داده",
    },
  ];

  const rows = list?.results;
  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>کلاینت‌ها</div>
        <div className={s.subtitle}>فعالیت، مصرف و پشتیبانی هر کلاینت</div>
      </div>
      <KpiStrip items={kpis} />
      <div className={s.split}>
        <div className={`card ${s.listCard}`}>
          <div className={s.toolbar}>
            <SearchBox value={q} onChange={setQ} placeholder="نام، شناسه، ایمیل یا IP…" />
            <Seg options={FILTERS} value={filter} onChange={setFilter} wrap />
            <span style={{ flex: 1 }} />
            <div className={s.sortWrap}>
              <span>مرتب‌سازی</span>
              <Seg options={SORTS} value={sort} onChange={setSort} />
            </div>
          </div>
          <ClientTable
            rows={rows}
            selected={selected}
            onSelect={(id) => select(id === selected ? null : id)}
            empty={st?.total === 0 ? "هنوز کلاینتی به پنل گزارش نداده است (راهنما: README، بخش «اتصال کلاینت‌ها»)." : "کلاینتی با این فیلتر پیدا نشد"}
          />
          <div className={s.footer}>
            {list
              ? `نمایش ${toFa(rows?.length ?? 0)} کلاینت از ${toFa(list.count)}${st ? ` · ${toFa(st.with_open_tickets)} کلاینت با بازخورد جدید` : ""}`
              : "…"}
          </div>
        </div>
        {selected && (
          <ClientPanel
            key={selected}
            id={selected}
            onClose={() => select(null)}
            onChanged={() => {
              mutate();
              mutateStats();
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsInner />
    </Suspense>
  );
}
