"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { avatarOf, initialOf, whenText } from "@/lib/people";
import { ACTIVITY_CATEGORY, jStamp, type ActivityPage, type ActivityRow } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { Empty, ErrorState, errText, I, Skeleton } from "./ui";

const RANGES: [string, string, number][] = [
  ["all", "همه", -1],
  ["1", "امروز", 0],
  ["7", "۷ روز", 6],
  ["30", "۳۰ روز", 29],
];

/** «YYYY-MM-DD» برای چند روز قبل (به وقت مرورگر) */
function dayString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** لاگ فعالیت‌ها: مالک (و هر کسی که مالک دسترسی داده) کارهای همهٔ کاربران را می‌بیند و می‌تواند روی یک نفر فیلتر کند. */
export function ActivityTab() {
  const flash = useToast();
  const [person, setPerson] = useState("");
  const [category, setCategory] = useState("");
  const [range, setRange] = useState("all");
  const [failedOnly, setFailedOnly] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  // صفحه‌های بعدی ("نمایش قدیمی‌تر") جدا از صفحهٔ اول نگه داشته می‌شوند و به فیلترِ زمان بارگذاری وابسته‌اند؛ با عوض شدن فیلتر کنار گذاشته می‌شوند
  const [pages, setPages] = useState<{ key: string; rows: ActivityRow[]; cursor: number | null | undefined }>({ key: "", rows: [], cursor: undefined });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (person) p.set("user", person);
    if (category) p.set("category", category);
    if (failedOnly) p.set("ok", "0");
    if (search) p.set("q", search);
    const days = RANGES.find(([id]) => id === range)?.[2] ?? -1;
    if (days >= 0) p.set("since", dayString(days));
    return p.toString();
  }, [person, category, failedOnly, search, range]);

  const key = `/api/settings/activity?${query}`;
  const more = pages.key === key ? pages.rows : [];
  const cursor = pages.key === key ? pages.cursor : undefined;
  // با صفحه‌های بارگذاری‌شده، تازه‌سازی خودکار صفحهٔ اول لیست را جابه‌جا می‌کرد؛ پس متوقف می‌شود
  const { data, error, mutate } = useSWR<ActivityPage>(key, fetcher, { refreshInterval: more.length ? 0 : 15000, keepPreviousData: true });

  if (error && !data) return <ErrorState onRetry={() => mutate()} />;
  if (!data) return <Skeleton />;

  const people = data.people ?? [];
  const rows = [...data.rows, ...more];
  const nextId = cursor === undefined ? data.next : cursor;
  const total = people.reduce((n, p) => n + p.count, 0);
  const filtered = !!(person || category || failedOnly || search || range !== "all");

  const loadMore = async () => {
    if (!nextId) return;
    setLoadingMore(true);
    try {
      const page = await api<ActivityPage>(`/api/settings/activity?${query}${query ? "&" : ""}before=${nextId}`);
      setPages((p) => ({ key, rows: [...(p.key === key ? p.rows : []), ...page.rows], cursor: page.next }));
    } catch (e) {
      flash(errText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="card" style={{ overflow: "visible" }}>
      <div className={s.people} role="group" aria-label="فیلتر بر اساس فرد">
        <button className={s.person} aria-pressed={person === ""} onClick={() => setPerson("")}>
          <span>همهٔ افراد</span>
          <small>{toFa(total)}</small>
        </button>
        {people.map((p) => {
          const [bg, color] = avatarOf(p.username);
          return (
            <button key={p.username} className={s.person} aria-pressed={person === p.username} onClick={() => setPerson(person === p.username ? "" : p.username)} title={p.exists ? p.username : `${p.username} (حساب حذف شده)`}>
              <span className={s.avatarSm} style={{ background: bg, color }}>{initialOf(p.display_name)}</span>
              <span>{p.display_name}</span>
              <small>{toFa(p.count)}</small>
            </button>
          );
        })}
      </div>

      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon d={I.search} size={15} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="جست‌وجو در شرح فعالیت…" aria-label="جست‌وجو در لاگ" />
        </label>
        <select className={s.select} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="بخش">
          <option value="">همهٔ بخش‌ها</option>
          {Object.entries(ACTIVITY_CATEGORY).map(([id, [label]]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <div className="seg">
          {RANGES.map(([id, label]) => (
            <button key={id} aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>
          ))}
        </div>
        <button className={s.btnGhost} aria-pressed={failedOnly} data-active={failedOnly} onClick={() => setFailedOnly(!failedOnly)} title="فقط ورودهای ناموفق و درخواست‌های ردشده">
          <Icon d={I.alert} size={15} /> فقط ناموفق‌ها
        </button>
        <span className={s.spacer} />
        <button className={s.iconBtn} onClick={() => mutate()} title="تازه‌سازی" aria-label="تازه‌سازی"><Icon d={I.refresh} size={16} /></button>
      </div>

      {rows.length > 0 && (
        <div className={s.acTh}>
          <span>زمان</span>
          <span>فرد</span>
          <span>شرح</span>
          <span>بخش</span>
          <span>IP</span>
        </div>
      )}
      {rows.map((r) => {
        const [bg, color] = avatarOf(r.username || "?");
        const [label, catBg, catColor] = ACTIVITY_CATEGORY[r.category] ?? ACTIVITY_CATEGORY.other;
        return (
          <div key={r.id} className={s.acRow} data-ok={r.ok}>
            <div className={s.muted} title={jStamp(r.ts)}>{whenText(r.ts)}</div>
            <button className={s.acWho} onClick={() => setPerson(r.username)} disabled={!r.username} title="فقط فعالیت‌های این فرد">
              <span className={s.avatarSm} style={{ background: bg, color }}>{initialOf(r.display_name)}</span>
              <span className={s.acName}>{r.display_name || "—"}</span>
            </button>
            <div className={s.acText}>
              {r.text}
              {!r.ok && <span className={`${s.badge} ${s.badgeFail}`}>ناموفق</span>}
            </div>
            <div><span className={s.badge} style={{ background: catBg, color: catColor }}>{label}</span></div>
            <div className={`${s.muted} mono`} dir="ltr">{r.ip || "—"}</div>
          </div>
        );
      })}

      {rows.length === 0 && (
        <Empty
          icon={I.activity}
          title={filtered ? "موردی پیدا نشد" : "هنوز فعالیتی ثبت نشده"}
          text={filtered ? "فیلترها را عوض کنید یا پاک کنید." : "ورود به پنل و هر تغییری که کاربران بدهند، از این به بعد اینجا ثبت می‌شود."}
          action={filtered ? <button className={s.btnGhost} onClick={() => { setPerson(""); setCategory(""); setFailedOnly(false); setText(""); setRange("all"); }}>پاک‌کردن فیلترها</button> : undefined}
        />
      )}
      {nextId && (
        <div className={s.loadMore}>
          <button className={s.btnGhost} onClick={loadMore} disabled={loadingMore}>{loadingMore ? "در حال بارگذاری…" : "نمایش فعالیت‌های قدیمی‌تر"}</button>
        </div>
      )}
    </div>
  );
}
