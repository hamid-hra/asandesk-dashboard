"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";

import { ActiveFilters } from "@/components/clients/ActiveFilters";
import { ClientChartsView } from "@/components/clients/charts/ClientCharts";
import { ClientPanel } from "@/components/clients/ClientPanel";
import { ClientTable } from "@/components/clients/ClientTable";
import s from "@/components/clients/clients.module.css";
import { KpiStrip } from "@/components/clients/KpiStrip";
import { activeCount, chips, type ClientFilters, DEFAULT_SORT, NO_FILTERS, queryParams, type SortState } from "@/components/clients/query";
import { SearchBox } from "@/components/clients/SearchBox";
import { type ViewTab, ViewTabs } from "@/components/clients/ViewTabs";
import { fetcher } from "@/lib/api";
import { fmt, pctText, toFa } from "@/lib/fa";
import { minutesText } from "@/lib/people";
import type { ClientCharts, ClientList, ClientStats } from "@/lib/types";

type View = "list" | "charts";

const LIST_ICON = "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01";
const CHART_ICON = "M4 20V11M10 20V4M16 20v-6M22 20H2";

function ClientsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("id");
  const view: View = params.get("view") === "charts" ? "charts" : "list";
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ClientFilters>(NO_FILTERS);

  const query = queryParams(sort, filters, q);
  const { data: list, mutate } = useSWR<ClientList>(view === "list" ? `/api/clients?${query}` : null, fetcher, { refreshInterval: 30000, keepPreviousData: true });
  const { data: charts, error: chartsError, mutate: reloadCharts } = useSWR<ClientCharts>(view === "charts" ? "/api/clients/charts" : null, fetcher, { refreshInterval: 60000 });
  const { data: st, mutate: mutateStats } = useSWR<ClientStats>("/api/clients/stats", fetcher, { refreshInterval: 30000 });

  const tabs: ViewTab<View>[] = [
    { id: "list", label: "فهرست کلاینت‌ها", icon: LIST_ICON, count: st?.total },
    { id: "charts", label: "نمودارها", icon: CHART_ICON },
  ];
  const setView = (v: View) => router.replace(v === "charts" ? `${pathname}?view=charts` : pathname, { scroll: false });
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
  const emptyText =
    st?.total === 0
      ? "هنوز کلاینتی به پنل گزارش نداده است (راهنما: README، بخش «اتصال کلاینت‌ها»)."
      : activeCount(filters)
        ? "کلاینتی با این فیلترها پیدا نشد؛ یکی از فیلترها را بردارید."
        : "کلاینتی با این جستجو پیدا نشد";
  return (
    <div className={s.page}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={s.title}>کلاینت‌ها</div>
        <div className={s.subtitle}>{view === "charts" ? "نصب‌ها بر اساس نسخه، پلتفرم و روز" : "فعالیت، مصرف و پشتیبانی هر کلاینت"}</div>
      </div>
      <ViewTabs tabs={tabs} value={view} onChange={setView} />
      {view === "charts" && <ClientChartsView data={charts} error={chartsError} onRetry={() => reloadCharts()} />}
      {view === "list" && <KpiStrip items={kpis} />}
      {view === "list" && <div className={s.split}>
        <div className={`card ${s.listCard}`}>
          <div className={s.toolbar}>
            <SearchBox value={q} onChange={setQ} placeholder="نام، شناسه، ایمیل یا IP…" />
            <span className={s.toolbarHint}>روی عنوان هر ستون بزنید تا فیلتر و مرتب کنید</span>
          </div>
          <ActiveFilters chips={chips(filters)} sort={sort} onSort={setSort} filters={filters} onFilters={setFilters} />
          <ClientTable
            rows={rows}
            selected={selected}
            onSelect={(id) => select(id === selected ? null : id)}
            sort={sort}
            onSort={setSort}
            filters={filters}
            onFilters={setFilters}
            facets={list?.facets}
            empty={emptyText}
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
      </div>}
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
